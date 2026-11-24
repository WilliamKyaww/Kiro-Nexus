// ReviewEngine: validate → journal → apply per file → review per change (architecture 7.2–7.5).
// All workspace I/O goes through WorkspaceService (single writer, R-C6).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  IssuesFile, OPEN_STATES, ProposedOperation, ReviewRun, serialise,
  type ChangeRecord, type ChangeView, type FileEntry, type IssuesFile as IssuesFileT, type RunOutcome,
} from "@nexus/schema";
import { NexusError } from "../errors";
import { faultPoint } from "../faults";
import { sha256 } from "../workspace/atomic";
import { newId, type WorkspaceService } from "../workspace/service";
import { canonical, sameValue, setField, validFieldValue } from "./records";
import { applyEdits, locate, normaliseSpan, splice } from "./spans";

type Actor = "agent" | "demo" | "user" | "system";
export interface Source { kind: "agent" | "fixed-demo"; label: string; conversationId?: string | null; model?: string | null }
const ISSUES = ".nexus/issues.json";
const now = () => new Date().toISOString();

export class ReviewEngine {
  private readonly runs = new Map<string, ReviewRun>();

  private constructor(private readonly service: WorkspaceService, private readonly publish: (e: { type: string; [k: string]: unknown }) => void, private readonly log: (l: string) => void) {}

  /** Load every journal, then resume interrupted work before anything else writes. */
  static async load(service: WorkspaceService, publish: ReviewEngine["publish"], log: (l: string) => void): Promise<ReviewEngine> {
    const engine = new ReviewEngine(service, publish, log);
    const names = await readdir(service.journalDir()).catch(() => [] as string[]);
    for (const name of names.filter((n) => /^run_[0-9A-Z]{26}\.json$/.test(n)).sort()) {
      try {
        const run = ReviewRun.parse(JSON.parse(await readFile(join(service.journalDir(), name), "utf8")));
        engine.runs.set(run.runId, run);
      } catch (e) {
        log(`review: skipped unreadable journal ${name}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    await engine.recover();
    return engine;
  }

  // ---------------- Queries ----------------

  private find(changeId: string): { run: ReviewRun; change: ChangeRecord } {
    for (const run of this.runs.values()) {
      const change = run.changes.find((c) => c.changeId === changeId);
      if (change) return { run, change };
    }
    throw new NexusError("NOT_FOUND", "That change does not exist.");
  }

  allChanges(): Array<{ run: ReviewRun; change: ChangeRecord }> {
    return [...this.runs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .flatMap((run) => run.changes.map((change) => ({ run, change })));
  }

  /** Changes whose effect is not yet final, used by the scheduler (D-C3). */
  unsettledChanges(): ChangeRecord[] {
    return this.allChanges().map((x) => x.change).filter((c) => OPEN_STATES.includes(c.state));
  }

  async views(filter: "open" | "all"): Promise<ChangeView[]> {
    const items = this.allChanges().filter(({ change }) => filter === "all" || OPEN_STATES.includes(change.state));
    const out: ChangeView[] = [];
    const notes = new Map<string, string | null>();
    for (const { run, change } of items) {
      let lines: ChangeView["lines"] = null;
      let current: unknown = null;
      if (change.kind === "note.replaceSpan") {
        if (!notes.has(change.file)) notes.set(change.file, (await this.service.readNoteRaw(change.file).catch(() => null))?.content ?? null);
        const content = notes.get(change.file);
        if (content != null && (change.state === "pending" || change.state === "conflicted")) {
          const loc = locate(content, String(change.after), change.context);
          if (loc.status === "ok") lines = { start: loc.start, end: loc.start + loc.length - 1 };
        }
      } else {
        const issue = this.service.listIssues().find((i) => i.id === change.target.recordId);
        current = issue && change.target.field ? issue[change.target.field] : null;
      }
      out.push({
        changeId: change.changeId, runId: run.runId, sourceKind: run.source.kind, sourceLabel: run.source.label,
        kind: change.kind, file: change.file, state: change.state, conflictReason: change.conflictReason,
        recordKey: change.target.recordKey, field: change.target.field, before: change.before, after: change.after,
        lines, current, feedback: change.feedback?.text ?? null, summary: summarise(change),
        fileState: run.files.find((f) => f.path === change.file)?.state ?? "planned",
        fileError: run.files.find((f) => f.path === change.file)?.error ?? null,
        runPhase: run.phase,
      });
    }
    return out;
  }

  // ---------------- Propose and apply ----------------

  async outcome(run: ReviewRun, duplicates: string[] = []): Promise<RunOutcome> {
    const ids = new Set(run.changes.map((c) => c.changeId));
    return {
      runId: run.runId,
      phase: run.phase,
      files: run.files.map((f) => ({ path: f.path, state: f.state, error: f.error })),
      changes: (await this.views("all")).filter((v) => ids.has(v.changeId)),
      duplicates,
      repeated: false,
    };
  }

  /** Runs with writes that did not happen, for the Retry / Discard prompt (also after a restart). */
  async incompleteRuns(): Promise<RunOutcome[]> {
    const out: RunOutcome[] = [];
    for (const run of this.runs.values()) if (run.files.some((f) => f.state === "failed")) out.push(await this.outcome(run));
    return out;
  }

  async propose(source: Source, operations: unknown[], by: Actor): Promise<RunOutcome> {
    return this.service.exclusive(async () => {
      const ops = operations.map((o, i) => {
        const r = ProposedOperation.safeParse(o);
        if (!r.success) throw new NexusError("VALIDATION", `Operation ${i + 1} is not valid.`, r.error.issues.slice(0, 3).map((x) => `${x.path.join(".")}: ${x.message}`));
        return r.data;
      });
      const known = new Map(this.allChanges().map(({ change }) => [change.opId, change.changeId]));
      const duplicates = ops.filter((o) => known.has(o.opId)).map((o) => o.opId);
      const fresh = ops.filter((o) => !known.has(o.opId));
      if (fresh.length === 0) {
        // Report the existing run honestly (including any write that never happened).
        const ids = new Set(duplicates.map((d) => known.get(d)));
        const existing = [...this.runs.values()].find((r) => r.changes.some((c) => ids.has(c.changeId)));
        if (existing) return { ...(await this.outcome(existing, duplicates)), repeated: true };
        return { runId: null, phase: null, files: [], changes: [], duplicates, repeated: true };
      }

      const errors: Array<{ opId: string; reason: string }> = [];
      const createdAt = now();
      const files: FileEntry[] = [];
      const changes: ChangeRecord[] = [];
      const mkChange = (op: ProposedOperation, extra: Partial<ChangeRecord>): ChangeRecord => ({
        changeId: newId("chg"), opId: op.opId, kind: op.kind, file: op.file,
        target: { recordId: null, recordKey: null, field: null }, baseRevision: op.baseRevision,
        before: op.before, after: op.after, context: null, dependsOn: [], supersedes: null,
        state: "prepared", conflictReason: null, reversal: null, feedback: null,
        history: [{ state: "prepared", at: createdAt, by, note: null }], ...extra,
      });

      // Notes: group by file, validate base revision and unique, non-overlapping spans.
      const noteOps = new Map<string, Extract<ProposedOperation, { kind: "note.replaceSpan" }>[]>();
      for (const op of fresh) {
        if (op.kind !== "note.replaceSpan") continue;
        let rel: string;
        try { rel = this.service.notePath(op.file).rel; } catch (e) { errors.push({ opId: op.opId, reason: (e as Error).message }); continue; }
        noteOps.set(rel, [...(noteOps.get(rel) ?? []), { ...op, file: rel }]);
      }
      for (const [rel, group] of noteOps) {
        const raw = await this.service.readNoteRaw(rel);
        if (!raw) { group.forEach((o) => errors.push({ opId: o.opId, reason: `Note not found: ${rel}` })); continue; }
        const stale = group.filter((o) => o.baseRevision !== raw.revision);
        if (stale.length) { stale.forEach((o) => errors.push({ opId: o.opId, reason: "The note changed after this edit was proposed." })); continue; }
        const edits = group.map((o) => ({ before: normaliseSpan(o.before), after: normaliseSpan(o.after) }));
        const result = applyEdits(raw.content, edits);
        if (!result.ok) {
          const why = { missing: "The text to change was not found as whole lines.", ambiguous: "The text to change appears more than once.", overlap: "Two edits overlap.", empty: "Nothing to change." }[result.reason];
          errors.push({ opId: group[result.index]!.opId, reason: why });
          continue;
        }
        files.push({ path: rel, beforeHash: raw.revision, afterHash: sha256(result.content), state: "planned", error: null });
        group.forEach((o, i) => changes.push(mkChange(o, { before: edits[i]!.before, after: edits[i]!.after, context: result.placed[i]!.context })));
      }

      // Records: one issues.json entry for the whole run.
      const recordOps = fresh.filter((o): o is Extract<ProposedOperation, { kind: "record.updateField" }> => o.kind === "record.updateField");
      if (recordOps.length) {
        const bytes = await this.service.readCollectionBytes("issues");
        let next: IssuesFileT = IssuesFile.parse(JSON.parse(bytes.toString("utf8")));
        const pendingRecordChanges: ChangeRecord[] = [];
        for (const op of recordOps) {
          const issue = next.issues.find((i) => i.key === op.recordKey);
          if (!issue) { errors.push({ opId: op.opId, reason: `Issue not found: ${op.recordKey}` }); continue; }
          const baseIssue = IssuesFile.parse(JSON.parse(bytes.toString("utf8"))).issues.find((i) => i.id === issue.id)!;
          if (baseIssue.revision !== op.baseRevision) { errors.push({ opId: op.opId, reason: `${op.recordKey} changed after this edit was proposed.` }); continue; }
          if (!sameValue(issue[op.field], op.before)) { errors.push({ opId: op.opId, reason: `${op.recordKey} ${op.field} no longer has the expected value.` }); continue; }
          if (!validFieldValue(issue, op.field, op.after)) { errors.push({ opId: op.opId, reason: `The new ${op.field} is not valid.` }); continue; }
          next = setField(next, issue.id, op.field, op.after, createdAt);
          pendingRecordChanges.push(mkChange(op, { target: { recordId: issue.id, recordKey: issue.key, field: op.field }, file: ISSUES }));
        }
        if (pendingRecordChanges.length) {
          files.push({ path: ISSUES, beforeHash: sha256(bytes), afterHash: sha256(serialise(IssuesFile, next)), state: "planned", error: null });
          changes.push(...pendingRecordChanges);
        }
      }

      if (errors.length) throw new NexusError("VALIDATION", "Some proposed changes could not be applied. Nothing was written.", errors);

      const run: ReviewRun = {
        schemaVersion: 1, runId: newId("run"),
        source: { kind: source.kind, label: source.label, conversationId: source.conversationId ?? null, model: source.model ?? null },
        createdAt, phase: "prepared", files, changes,
      };
      this.runs.set(run.runId, run);
      await this.persist(run); // the journal exists before any workspace file is touched (R-C1)
      faultPoint("review:after-journal");
      await this.applyRun(run, by);
      this.publish({ type: "review.updated" });
      return this.outcome(run, duplicates);
    });
  }

  private async persist(run: ReviewRun): Promise<void> {
    await this.service.writeJournalUnlocked(run.runId, serialise(ReviewRun, run));
  }

  /** Recompute a file's expected content from its current bytes, refusing if it is not at beforeHash. */
  private async expectedContent(run: ReviewRun, file: FileEntry): Promise<{ kind: "note"; content: string } | { kind: "issues"; value: IssuesFileT } | { kind: "changed" }> {
    const changes = run.changes.filter((c) => c.file === file.path && c.state === "prepared");
    const at = file.appliedAt ?? run.createdAt;
    if (file.path === ISSUES) {
      const bytes = await this.service.readCollectionBytes("issues");
      if (sha256(bytes) !== file.beforeHash) return { kind: "changed" };
      let next = IssuesFile.parse(JSON.parse(bytes.toString("utf8")));
      for (const c of changes) next = setField(next, c.target.recordId!, c.target.field!, c.after, at);
      if (sha256(serialise(IssuesFile, next)) !== file.afterHash) throw new NexusError("INTERNAL", "Recomputed issues do not match the journal.");
      return { kind: "issues", value: next };
    }
    const raw = await this.service.readNoteRaw(file.path);
    if (!raw || raw.revision !== file.beforeHash) return { kind: "changed" };
    const result = applyEdits(raw.content, changes.map((c) => ({ before: String(c.before), after: String(c.after) })));
    if (!result.ok || sha256(result.content) !== file.afterHash) throw new NexusError("INTERNAL", `Recomputed ${file.path} does not match the journal.`);
    return { kind: "note", content: result.content };
  }

  private async currentHash(path: string): Promise<string | null> {
    if (path === ISSUES) return sha256(await this.service.readCollectionBytes("issues"));
    return (await this.service.readNoteRaw(path))?.revision ?? null;
  }

  private mark(run: ReviewRun, change: ChangeRecord, state: ChangeRecord["state"], by: Actor, note: string | null = null) {
    change.state = state;
    change.history.push({ state, at: now(), by, note });
  }

  /** Write one planned file. On failure the file is marked `failed` with the reason; nothing else changes. */
  private async writePlanned(run: ReviewRun, file: FileEntry, by: Actor): Promise<boolean> {
    try {
      faultPoint(`review:write:${file.path}`);
      const expected = await this.expectedContent(run, file);
      if (expected.kind === "changed") throw new NexusError("CONFLICT", `${file.path} changed before the edit could be written.`);
      if (expected.kind === "issues") await this.service.writeCollectionUnlocked("issues", IssuesFile, expected.value);
      else await this.service.writeNoteUnlocked(file.path, expected.content);
    } catch (e) {
      file.state = "failed";
      file.error = (e as Error).message;
      return false;
    }
    faultPoint("review:after-file-write");
    file.state = "written";
    file.error = null;
    for (const c of run.changes.filter((c) => c.file === file.path && c.state === "prepared")) this.mark(run, c, "pending", by);
    return true;
  }

  private settlePhase(run: ReviewRun): void {
    const outstanding = run.files.some((f) => f.state === "planned" || f.state === "failed");
    run.phase = outstanding ? "partial" : "applied";
  }

  private async applyPlanned(run: ReviewRun, by: Actor): Promise<void> {
    run.phase = "applying";
    const planned = run.files.filter((f) => f.state === "planned");
    for (const [index, file] of planned.entries()) {
      const ok = await this.writePlanned(run, file, by);
      if (!ok) {
        // Later files are not attempted. They become `failed` too, so a restart never writes them silently.
        for (const rest of planned.slice(index + 1)) {
          rest.state = "failed";
          rest.error = `Not attempted, because ${file.path} could not be written.`;
        }
        this.settlePhase(run);
        await this.persist(run);
        this.log(`review: run partially applied; ${planned.length - index} file(s) not written`);
        return;
      }
      if (index < planned.length - 1) await this.persist(run);
    }
    this.settlePhase(run);
    await this.persist(run);
  }

  private async applyRun(run: ReviewRun, by: Actor): Promise<void> {
    await this.applyPlanned(run, by);
  }

  /**
   * Re-plan a failed file against its current contents (architecture 7.3).
   * Changes whose `before` no longer matches become conflicted; the rest are
   * recomputed with fresh hashes, so unrelated newer edits are kept.
   */
  private async replan(run: ReviewRun, file: FileEntry, at: string): Promise<"planned" | "nothing-left"> {
    const prepared = run.changes.filter((c) => c.file === file.path && c.state === "prepared");
    const conflict = (c: ChangeRecord, note: string) => {
      c.conflictReason = "changed-before-apply";
      this.mark(run, c, "conflicted", "system", note);
    };
    if (file.path === ISSUES) {
      const bytes = await this.service.readCollectionBytes("issues");
      let next = IssuesFile.parse(JSON.parse(bytes.toString("utf8")));
      let kept = 0;
      for (const c of prepared) {
        const issue = next.issues.find((i) => i.id === c.target.recordId);
        if (!issue || !sameValue(issue[c.target.field!], c.before) || !validFieldValue(issue, c.target.field!, c.after)) {
          conflict(c, "retry: the field no longer has the value this change expected");
          continue;
        }
        next = setField(next, issue.id, c.target.field!, c.after, at);
        kept += 1;
      }
      if (kept === 0) return "nothing-left";
      file.beforeHash = sha256(bytes);
      file.afterHash = sha256(serialise(IssuesFile, next));
      file.appliedAt = at;
      return "planned";
    }
    const raw = await this.service.readNoteRaw(file.path);
    if (!raw) { prepared.forEach((c) => conflict(c, "retry: the note no longer exists")); return "nothing-left"; }
    let candidates = [...prepared];
    for (;;) {
      if (candidates.length === 0) return "nothing-left";
      const result = applyEdits(raw.content, candidates.map((c) => ({ before: String(c.before), after: String(c.after) })));
      if (result.ok) {
        file.beforeHash = raw.revision;
        file.afterHash = sha256(result.content);
        file.appliedAt = at;
        candidates.forEach((c, i) => { c.context = result.placed[i]!.context; });
        return "planned";
      }
      const bad = candidates[result.index]!;
      conflict(bad, `retry: the text to change is ${result.reason === "missing" ? "no longer there" : "now ambiguous"}`);
      candidates = candidates.filter((c) => c !== bad);
    }
  }

  /** Retry every outstanding (failed) file of a run. Idempotent. */
  async retry(runId: string): Promise<RunOutcome> {
    return this.service.exclusive(async () => {
      const run = this.runs.get(runId);
      if (!run) throw new NexusError("NOT_FOUND", "That review run does not exist.");
      const failed = run.files.filter((f) => f.state === "failed");
      if (failed.length === 0) return this.outcome(run);
      const at = now();
      for (const file of failed) {
        const result = await this.replan(run, file, at);
        if (result === "nothing-left") {
          file.state = "conflicted";
          file.error = "Nothing left to write: the file changed in a way that conflicts with every change.";
        } else {
          file.state = "planned";
          file.error = null;
        }
      }
      await this.persist(run); // new hashes are durable before any write (write-ahead)
      await this.applyPlanned(run, "user");
      this.publish({ type: "review.updated" });
      return this.outcome(run);
    });
  }

  /** Drop the changes of every outstanding file without writing. Successful sibling changes are untouched. Idempotent. */
  async discard(runId: string): Promise<RunOutcome> {
    return this.service.exclusive(async () => {
      const run = this.runs.get(runId);
      if (!run) throw new NexusError("NOT_FOUND", "That review run does not exist.");
      const failed = run.files.filter((f) => f.state === "failed");
      if (failed.length === 0) return this.outcome(run);
      for (const file of failed) {
        file.state = "discarded";
        for (const c of run.changes.filter((c) => c.file === file.path && c.state === "prepared")) {
          this.mark(run, c, "rejected", "user", "discarded: never written to the file");
        }
      }
      this.settlePhase(run);
      await this.persist(run);
      this.publish({ type: "review.updated" });
      return this.outcome(run);
    });
  }
  // ---------------- Decisions ----------------

  async accept(changeId: string): Promise<ChangeView> {
    return this.service.exclusive(async () => {
      const { run, change } = this.find(changeId);
      if (change.state === "accepted") return this.viewOf(changeId);
      if (change.state !== "pending") throw new NexusError("CONFLICT", `This change is ${change.state} and cannot be accepted.`);
      this.mark(run, change, "accepted", "user");
      await this.persist(run);
      this.publish({ type: "review.updated" });
      return this.viewOf(changeId);
    });
  }

  async keepCurrent(changeId: string): Promise<ChangeView> {
    return this.service.exclusive(async () => {
      const { run, change } = this.find(changeId);
      if (change.state === "rejected") return this.viewOf(changeId);
      if (change.state !== "conflicted") throw new NexusError("CONFLICT", "Only a conflicted change can be closed this way.");
      this.mark(run, change, "rejected", "user", "kept the current version");
      await this.persist(run);
      this.publish({ type: "review.updated" });
      return this.viewOf(changeId);
    });
  }

  async feedback(changeId: string, text: string): Promise<ChangeView> {
    return this.service.exclusive(async () => {
      const { run, change } = this.find(changeId);
      if (change.state !== "rejected" && change.state !== "superseded") throw new NexusError("CONFLICT", "Feedback is for rejected changes.");
      change.feedback = { text, at: now() };
      await this.persist(run);
      this.publish({ type: "review.updated" });
      return this.viewOf(changeId);
    });
  }

  /** Compute the reversal of one change against the current file, or the reason it cannot be reversed. */
  private async planReversal(change: ChangeRecord, at: string):
    Promise<{ ok: true; beforeHash: string; afterHash: string; write: () => Promise<void> } | { ok: false; reason: "missing" | "ambiguous" | "changed" }> {
    if (change.kind === "note.replaceSpan") {
      const raw = await this.service.readNoteRaw(change.file);
      if (!raw) return { ok: false, reason: "missing" };
      const loc = locate(raw.content, String(change.after), change.context);
      if (loc.status !== "ok") return { ok: false, reason: loc.status };
      const content = splice(raw.content, loc.start, loc.length, String(change.before));
      return { ok: true, beforeHash: raw.revision, afterHash: sha256(content), write: async () => { await this.service.writeNoteUnlocked(change.file, content); } };
    }
    const bytes = await this.service.readCollectionBytes("issues");
    const file = IssuesFile.parse(JSON.parse(bytes.toString("utf8")));
    const issue = file.issues.find((i) => i.id === change.target.recordId);
    if (!issue) return { ok: false, reason: "missing" };
    if (!sameValue(issue[change.target.field!], change.after)) return { ok: false, reason: "changed" };
    const next = setField(file, issue.id, change.target.field!, change.before, at);
    return { ok: true, beforeHash: sha256(bytes), afterHash: sha256(serialise(IssuesFile, next)), write: async () => { await this.service.writeCollectionUnlocked("issues", IssuesFile, next); } };
  }

  async reject(changeId: string): Promise<ChangeView> {
    return this.service.exclusive(async () => {
      const { run, change } = this.find(changeId);
      if (["rejected", "superseded", "conflicted"].includes(change.state)) return this.viewOf(changeId);
      if (change.state !== "pending") throw new NexusError("CONFLICT", `This change is ${change.state} and cannot be rejected.`);
      const at = now();
      const plan = await this.planReversal(change, at);
      if (!plan.ok) {
        change.conflictReason = plan.reason;
        this.mark(run, change, "conflicted", "system", `reversal blocked: ${plan.reason}`);
        await this.persist(run);
        this.publish({ type: "review.updated" });
        return this.viewOf(changeId);
      }
      change.reversal = { beforeHash: plan.beforeHash, afterHash: plan.afterHash, at };
      this.mark(run, change, "rejecting", "user");
      await this.persist(run); // reversal intent is durable before the file changes
      faultPoint("review:after-reversal-journal");
      await plan.write();
      faultPoint("review:after-reversal-write");
      this.mark(run, change, "rejected", "user");
      await this.persist(run);
      this.publish({ type: "review.updated" });
      return this.viewOf(changeId);
    });
  }

  private async viewOf(changeId: string): Promise<ChangeView> {
    return (await this.views("all")).find((v) => v.changeId === changeId)!;
  }

  // ---------------- Recovery (architecture 7.5) ----------------

  async recover(): Promise<void> {
    await this.service.exclusive(async () => {
      for (const run of this.runs.values()) {
        let touched = false;
        if (run.phase !== "applied") {
          for (const file of run.files.filter((f) => f.state === "planned")) {
            touched = true;
            const hash = await this.currentHash(file.path);
            const changes = run.changes.filter((c) => c.file === file.path);
            if (hash === file.afterHash) {
              file.state = "written";
              changes.filter((c) => c.state === "prepared").forEach((c) => this.mark(run, c, "pending", "system", "recovered: write had completed"));
            } else if (hash === file.beforeHash) {
              const expected = await this.expectedContent(run, file);
              if (expected.kind === "issues") await this.service.writeCollectionUnlocked("issues", IssuesFile, expected.value);
              else if (expected.kind === "note") await this.service.writeNoteUnlocked(file.path, expected.content);
              file.state = "written";
              changes.filter((c) => c.state === "prepared").forEach((c) => this.mark(run, c, "pending", "system", "recovered: write rolled forward"));
            } else {
              file.state = "conflicted";
              changes.filter((c) => c.state === "prepared").forEach((c) => { c.conflictReason = "changed-before-apply"; this.mark(run, c, "conflicted", "system", "file changed before the edit was written"); });
            }
          }
          this.settlePhase(run);
        }
        for (const change of run.changes.filter((c) => c.state === "rejecting")) {
          touched = true;
          const hash = await this.currentHash(change.file);
          if (hash === change.reversal?.afterHash) {
            this.mark(run, change, "rejected", "system", "recovered: reversal had completed");
          } else if (change.reversal && hash === change.reversal.beforeHash) {
            const plan = await this.planReversal(change, change.reversal.at);
            if (plan.ok && plan.afterHash === change.reversal.afterHash) {
              await plan.write();
              this.mark(run, change, "rejected", "system", "recovered: reversal rolled forward");
            } else {
              change.conflictReason = "changed";
              this.mark(run, change, "conflicted", "system", "reversal could not be recomputed");
            }
          } else {
            change.conflictReason = "changed";
            this.mark(run, change, "conflicted", "system", "file changed during the reversal");
          }
        }
        if (touched) {
          await this.persist(run);
          this.log(`review: recovered run ${run.runId.slice(0, 12)}…`);
        }
      }
    });
  }
}

function firstLine(value: unknown): string {
  const s = String(value ?? "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

function summarise(change: ChangeRecord): string {
  if (change.kind === "note.replaceSpan") return `${change.file}: “${firstLine(change.before)}” → “${firstLine(change.after)}”`;
  const show = (v: unknown) => (v && typeof v === "object" && "date" in (v as object) ? String((v as { date: string }).date) : v === null ? "none" : canonical(v).replace(/^"|"$/g, ""));
  return `${change.target.recordKey} ${change.target.field}: ${show(change.before)} → ${show(change.after)}`;
}
