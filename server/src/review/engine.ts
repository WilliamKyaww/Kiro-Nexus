// ReviewEngine: validate → journal → apply per file → review per change (architecture 7.2–7.5).
// All workspace I/O goes through WorkspaceService (single writer, R-C6).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ISSUE_REF, Issue, IssuesFile, OPEN_STATES, ProposedOperation, ReviewRun, serialise,
  type ChangeRecord, type ChangeView, type Correction, type FileEntry, type IssuesFile as IssuesFileT, type NoteLink, type RunOutcome,
} from "@nexus/schema";
import { parseHeadings } from "@nexus/markdown";
import { NexusError } from "../errors";
import { faultPoint } from "../faults";
import { sha256 } from "../workspace/atomic";
import { newId, type WorkspaceService } from "../workspace/service";
import { addIssue, addLink, applyRecordChange, canonical, createdUnchanged, hasLink, removeIssue, removeLink, sameValue, setField, validFieldValue } from "./records";
import { slugMoves } from "../notes/align";
import { applyEdits, changeSection, locate, locateChange, normaliseSpan, scopeOf, splice, uniqueInSection, type LocateResult, type SpanEdit } from "./spans";

/** How often a note text names an issue key as a whole word. */
const mentions = (text: string, key: string) => (text.match(new RegExp(`(?<![A-Za-z0-9-])${key.replace(/[-]/g, "\\-")}(?![0-9])`, "g")) ?? []).length;

type Actor = "agent" | "demo" | "user" | "system";
export interface HeadingAlias {
  slug: string; to: string; toText: string;
  /** uncertain: a heading of that name may be a different section than a link made earlier meant (R5-10). */
  reason: "pending-rename" | "renamed" | "rename-rejected" | "uncertain";
  /** Which text the slug belongs to: the accepted text (Ask citations) or the text on disk. */
  ref: "accepted" | "disk";
  /** When the move happened (a decision); null for moves that exist only while edits are pending. */
  at: string | null;
}
export interface Source { kind: "agent" | "fixed-demo"; label: string; conversationId?: string | null; model?: string | null }
const ISSUES = ".nexus/issues.json";
const now = () => new Date().toISOString();
/** Corrections the review bar still lists: under way, waiting to be written, or open to Retry. */
const OUTSTANDING_CORRECTION: readonly Correction["state"][] = ["queued", "running", "unwritten", "failed", "no-change"];
/** Corrections that hold the change: no new correction may start, and the reason stays as it is. */
const HOLDING_CORRECTION: readonly Correction["state"][] = ["running", "unwritten", "proposed"];
/** A change that reached review (it was written), as opposed to one discarded unwritten (R6-3). */
const reviewable = (c: ChangeRecord) => c.history.some((h) => h.state === "pending");
/**
 * A reason can start a correction run for an Edit change to an issue field or to note lines.
 * A new issue or link would need a new issue or link as its correction, which is a later slice.
 */
const correctable = (run: ReviewRun, change: ChangeRecord) =>
  run.source.kind === "agent" && !!run.source.conversationId && (change.kind === "record.updateField" || change.kind === "note.replaceSpan");
export interface ProposeOptions {
  /** The rejected change this proposal corrects, and the correction run proposing it. */
  supersedes?: string;
  correctionRunId?: string;
}

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

  /**
   * How heading slugs of one note move, so that a saved heading link still opens its section
   * during review, after acceptance and after rejection (Ask requirement 10.2, R4-8):
   * - `ref: "accepted"` aliases are for links to the accepted text (Ask citations). While edits
   *   await review they map each accepted slug to the same heading on disk ("pending-rename");
   *   an acceptance records how accepted slugs moved, with its time ("renamed").
   * - `ref: "disk"` aliases are for links to the text on disk: a rejection records how slugs on
   *   disk moved ("rename-rejected").
   * Slugs are compared over the whole document, so dedup suffixes (beta-1) are kept right.
   */
  headingAliases(path: string, disk: string | null): HeadingAlias[] {
    const out: HeadingAlias[] = [];
    if (disk !== null) {
      const accepted = this.acceptedText(disk, path, []);
      if (accepted !== disk) {
        for (const m of slugMoves(accepted, disk)) out.push({ slug: m.from, to: m.to, toText: m.toText, reason: "pending-rename", ref: "accepted", at: null });
      }
    }
    for (const { change } of this.allChanges()) {
      if (change.kind !== "note.replaceSpan" || change.file !== path) continue;
      if (change.slugMoves) {
        const m = change.slugMoves;
        for (const move of m.moves) out.push({ slug: move.from, to: move.to, toText: move.toText, reason: m.ref === "accepted" ? "renamed" : "rename-rejected", ref: m.ref, at: m.at });
        continue;
      }
      // Changes decided before run 5 recorded no moves: derive the rename from the change itself.
      if (OPEN_STATES.includes(change.state)) continue;
      const decidedAt = change.history[change.history.length - 1]?.at ?? null;
      const from = parseHeadings(String(change.before));
      const to = parseHeadings(String(change.after));
      if (!from.length || from.length !== to.length) continue;
      const onDisk = disk !== null ? parseHeadings(disk) : [];
      from.forEach((f, i) => {
        const t = to[i]!;
        if (f.slug === t.slug) return;
        const ref = change.state === "accepted" ? "accepted" as const : "disk" as const;
        const [oldText, newText] = change.state === "accepted" ? [f.text, t.text] : [t.text, f.text];
        if (change.state === "accepted") out.push({ slug: f.slug, to: t.slug, toText: t.text, reason: "renamed", ref, at: decidedAt });
        else out.push({ slug: t.slug, to: f.slug, toText: f.text, reason: "rename-rejected", ref, at: decidedAt });
        // The rename gave the heading the name of another one, which shifted the other's slug,
        // and a run-4 journal does not say how. Links to that name are reported as uncertain
        // rather than resolved to a guess (R5-10).
        const sameName = onDisk.filter((h) => h.text === newText);
        if (sameName.length > 1 && oldText !== newText) {
          for (const h of sameName) out.push({ slug: h.slug, to: h.slug, toText: h.text, reason: "uncertain", ref, at: decidedAt });
        }
      });
    }
    return out;
  }

  /**
   * What happened to a new issue that a review run proposed with this key, if one did: an old
   * link to a rejected proposal can then say so, rather than show nothing (R4-7).
   */
  proposedIssue(key: string): { key: string; title: string; state: ChangeRecord["state"]; at: string; source: string; reusedBy: string | null } | null {
    const found = [...this.allChanges()].reverse().find(({ change }) => change.kind === "record.create" && change.target.recordKey === key);
    if (!found) return null;
    const { run, change } = found;
    // A workspace from before run 5 may already have given this key to a different issue (R5-7):
    // links made for the proposal then lead to that issue, so the issue page says so.
    const holder = this.service.listIssues().find((i) => i.key === key);
    const reusedBy = holder && holder.id !== change.target.recordId ? holder.title : null;
    return { key, title: (change.after as { title?: string })?.title ?? "", state: change.state, at: change.history[change.history.length - 1]?.at ?? run.createdAt, source: run.source.label, reusedBy };
  }

  /** "corrections": rejected changes whose correction is running, failed or proposed nothing. */
  async views(filter: "open" | "all" | "corrections"): Promise<ChangeView[]> {
    const items = this.allChanges().filter(({ change }) => filter === "all"
      || (filter === "open" ? OPEN_STATES.includes(change.state) : change.state === "rejected" && OUTSTANDING_CORRECTION.includes(change.correction?.state ?? "dropped")));
    const supersededBy = new Map<string, string[]>();
    for (const { change } of this.allChanges()) if (change.supersedes) supersededBy.set(change.supersedes, [...(supersededBy.get(change.supersedes) ?? []), change.changeId]);
    const out: ChangeView[] = [];
    const notes = new Map<string, string | null>();
    for (const { run, change } of items) {
      let lines: ChangeView["lines"] = null;
      let current: unknown = null;
      if (change.kind === "note.replaceSpan") {
        if (!notes.has(change.file)) notes.set(change.file, (await this.service.readNoteRaw(change.file).catch(() => null))?.content ?? null);
        const content = notes.get(change.file);
        if (content != null && (change.state === "pending" || change.state === "conflicted")) {
          const loc = this.locateNoteChange(content, change);
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
        dependsOn: change.dependsOn,
        dependents: run.changes.filter((c) => c.dependsOn.includes(change.changeId)).map((c) => c.changeId),
        supersedes: change.supersedes,
        supersededBy: supersededBy.get(change.changeId) ?? [],
        correctable: correctable(run, change),
        conversationId: run.source.conversationId,
        correction: change.correction ?? null,
      });
    }
    return out;
  }

  /**
   * A note change's recorded section slug as it is on disk now: the heading moves that later
   * rejections recorded (`slugMoves`, ref "disk") are followed in order (R6-1).
   */
  private slugMapFor(change: ChangeRecord): (slug: string) => string {
    const since = change.history[0]?.at ?? "";
    const later = this.allChanges().map((x) => x.change)
      .filter((c) => c !== change && c.file === change.file && c.slugMoves?.ref === "disk" && c.slugMoves.at >= since)
      .sort((a, b) => a.slugMoves!.at.localeCompare(b.slugMoves!.at));
    return (slug) => later.reduce((s, c) => c.slugMoves!.moves.find((m) => m.from === s)?.to ?? s, slug);
  }

  /**
   * Where the lines a note change wrote are now, by one set of rules for reversal, the accepted
   * text, the review bar, overlap and group decisions: an Edit change is looked for only in its
   * own section (R6-1; `locateChange` in spans.ts).
   */
  locateNoteChange(content: string, change: ChangeRecord): LocateResult {
    return locateChange(content, change, this.slugMapFor(change));
  }

  /** The rejected change and its run, for a correction (PRD-064). */
  correctionTarget(changeId: string): { run: ReviewRun; change: ChangeRecord } {
    const found = this.find(changeId);
    return { run: structuredClone(found.run), change: structuredClone(found.change) };
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

  async propose(source: Source, operations: unknown[], by: Actor, opts: ProposeOptions = {}): Promise<RunOutcome> {
    return this.service.exclusive(async () => {
      const ops = operations.map((o, i) => {
        const r = ProposedOperation.safeParse(o);
        if (!r.success) throw new NexusError("VALIDATION", `Operation ${i + 1} is not valid.`, r.error.issues.slice(0, 3).map((x) => `${x.path.join(".")}: ${x.message}`));
        return r.data;
      });
      // A correction is bound to the rejected change and to the correction run it started: it is
      // refused once that change was corrected, its correction dropped, or another run took over.
      const corrected = opts.supersedes ? this.find(opts.supersedes) : null;
      if (corrected) {
        const c = corrected.change;
        if (c.state !== "rejected" || c.correction?.state !== "running" || c.correction.askRunId !== (opts.correctionRunId ?? null)) {
          throw new NexusError("CONFLICT", "This correction is no longer wanted: the rejected change was corrected or kept rejected meanwhile. Nothing was written.", { reason: "correction-closed" });
        }
        // The write boundary (R6-4), checked here under the write lock: one operation, of the same
        // kind, on the same field of the same issue or the same note. For notes, the lines it will
        // actually change must lie inside the disputed lines; that is checked once they are placed.
        const outside = this.outsideCorrection(c, ops);
        if (outside) throw new NexusError("VALIDATION", outside, [{ opId: ops[0]?.opId ?? "", reason: outside }]);
      }
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
        target: { recordId: null, recordKey: null, field: null }, baseRevision: "baseRevision" in op && op.baseRevision !== undefined ? op.baseRevision : 0,
        before: "before" in op ? op.before : null, after: "after" in op ? op.after : null, context: null, dependsOn: [], supersedes: opts.supersedes ?? null,
        state: "prepared", conflictReason: null, reversal: null, feedback: null,
        history: [{ state: "prepared", at: createdAt, by, note: null }], ...extra,
      });

      // Changes still awaiting a decision. A new proposal may not overlap one (the same field,
      // the same note lines) or build on an issue that is itself still a proposal: its accepted
      // value would then depend on the order of two decisions (R4-2, R4-9).
      const open = this.unsettledChanges().filter((c) => c.state !== "rejecting");
      const openCreates = new Map(open.filter((c) => c.kind === "record.create").map((c) => [c.target.recordId, c]));
      const proposedKeys = [...openCreates.values()].map((c) => c.target.recordKey!).filter(Boolean);
      const stillProposed = (key: string) => `${key} is a new issue that is still awaiting review. Accept or reject it before proposing changes that build on it.`;

      // New issues get their keys first, so that links and note edits in the same proposal can
      // refer to them ({{issue:<opId>}} or issueRef). The key comes from the project's counter and
      // existing keys, as for a manual create. Its number is reserved in projects.json before the
      // journal is written, so a rejected proposal's key is never given to another issue (R4-7).
      const created = new Map<string, Issue>();
      const issuesNow = this.service.issuesSnapshot();
      for (const op of fresh) {
        if (op.kind !== "record.create") continue;
        const project = this.service.listProjects().find((p) => p.key === op.projectKey);
        if (!project) { errors.push({ opId: op.opId, reason: `Project not found: ${op.projectKey}` }); continue; }
        const used = [...issuesNow.issues, ...created.values()].filter((i) => i.projectId === project.id).map((i) => Number(i.key.split("-")[1]));
        const n = Math.max(project.nextIssueNumber, ...used.map((u) => u + 1), 1);
        created.set(op.opId, Issue.parse({
          id: newId("iss"), key: `${project.key}-${n}`, projectId: project.id, title: op.title, description: op.description ?? "",
          status: op.status ?? "todo", priority: op.priority ?? "medium", due: op.due ?? null, rank: String(n).padStart(8, "0"),
          noteLinks: [], createdAt, updatedAt: createdAt, revision: 1,
        }));
      }
      const refsIn = (text: string) => [...text.matchAll(ISSUE_REF)].map((m) => m[1]!);
      const opDeps = new Map<string, string[]>();

      // Notes: group by file, validate base revision and unique, non-overlapping spans.
      const noteOps = new Map<string, Extract<ProposedOperation, { kind: "note.replaceSpan" }>[]>();
      for (const op of fresh) {
        if (op.kind !== "note.replaceSpan") continue;
        let rel: string;
        try { rel = this.service.notePath(op.file).rel; } catch (e) { errors.push({ opId: op.opId, reason: (e as Error).message }); continue; }
        const refs = refsIn(op.after);
        const unknown = refs.filter((r) => !created.has(r));
        if (unknown.length) { errors.push({ opId: op.opId, reason: `The edit refers to an issue this proposal does not create: ${unknown.join(", ")}` }); continue; }
        opDeps.set(op.opId, [...new Set([...(op.dependsOn ?? []), ...refs])]);
        const after = op.after.replace(ISSUE_REF, (_m, ref: string) => created.get(ref)!.key);
        const mentioned = proposedKeys.find((k) => mentions(after, k) > mentions(op.before, k));
        if (mentioned) { errors.push({ opId: op.opId, reason: stillProposed(mentioned) }); continue; }
        noteOps.set(rel, [...(noteOps.get(rel) ?? []), { ...op, file: rel, after }]);
      }
      for (const [rel, group] of noteOps) {
        const raw = await this.service.readNoteRaw(rel);
        if (!raw) { group.forEach((o) => errors.push({ opId: o.opId, reason: `Note not found: ${rel}` })); continue; }
        const stale = group.filter((o) => o.baseRevision !== raw.revision);
        if (stale.length) { stale.forEach((o) => errors.push({ opId: o.opId, reason: "The note changed after this edit was proposed." })); continue; }
        // A scoped edit may touch only the section the run read, and only while that section
        // still has the text the run read (R4-1).
        const headings = parseHeadings(raw.content);
        let scopeError = false;
        const edits: SpanEdit[] = group.map((o) => {
          const base = { before: normaliseSpan(o.before), after: normaliseSpan(o.after) };
          if (!o.scope) return base;
          const s = scopeOf(raw.content, o.scope.headingSlug, headings, o.scope.lines);
          if (!s) { errors.push({ opId: o.opId, reason: "The section to edit is no longer in the note." }); scopeError = true; return base; }
          if (sha256(s.text) !== o.scope.sectionHash) {
            errors.push({ opId: o.opId, reason: "The section has changed since it was read, or has an edit awaiting review. Read it again after any pending changes are decided." });
            scopeError = true;
          }
          return { ...base, range: s.range };
        });
        if (scopeError) continue;
        const result = applyEdits(raw.content, edits);
        if (!result.ok) {
          const why = { missing: "The text to change was not found as whole lines.", ambiguous: "The text to change appears more than once.", overlap: "Two edits overlap.", empty: "Nothing to change." }[result.reason];
          errors.push({ opId: group[result.index]!.opId, reason: group[result.index]!.scope ? `${why.replace(/\.$/, "")} in the section that was read.` : why });
          continue;
        }
        // A correction may change only the lines the rejected change covered, where they are now
        // (R6-4): the lines this edit will actually replace must lie inside them.
        if (corrected) {
          const region = this.correctionRegion(raw.content, corrected.change);
          const strays = group.filter((_, i) => {
            const l = result.located[i]!;
            return !region || l.start < region.start || l.start + Math.max(l.length, 1) > region.end;
          });
          if (strays.length) {
            strays.forEach((o) => errors.push({ opId: o.opId, reason: region
              ? `A correction may change only the lines of the rejected change (lines ${region.start + 1} to ${region.end} of the note now). This edit reaches other lines, so Nexus wrote nothing. Propose an edit of those lines only.`
              : "The lines the rejected change covered can no longer be found, so a correction cannot be placed. Nexus wrote nothing." }));
            continue;
          }
        }
        // An Edit change is found again by its lines in its own section, so its new lines must be
        // the only copy there once written; otherwise a later Reject could not tell them from the
        // other copy (R6-1).
        const repeated = group.findIndex((o, i) => !!o.scope
          && !uniqueInSection(result.content, { before: edits[i]!.before, after: edits[i]!.after, context: result.placed[i]!.context, scope: o.scope }, result.placed[i]!.start));
        if (repeated >= 0) {
          errors.push({ opId: group[repeated]!.opId, reason: "The new lines would appear more than once in the section, so Nexus could not tell later which of them this change wrote. Make the new lines different from the other lines of the section." });
          continue;
        }
        // Lines that another change still awaiting a decision has written, or will write. A
        // change whose lines can no longer be found (edited by hand, then a conflict) still owns
        // the region between its saved neighbouring lines. An Edit change owns at least its own
        // section; when even that is unknown, the note takes no new edit until the change is
        // decided (R5-9, R6-1).
        let unlocated: ChangeRecord | null = null;
        const busy = open.filter((c) => c.kind === "note.replaceSpan" && c.file === rel).flatMap((c): Array<{ start: number; end: number; lost?: ChangeRecord }> => {
          const loc = c.state === "prepared" ? locate(raw.content, String(c.before), null) : this.locateNoteChange(raw.content, c);
          if (loc.status === "ok") return [{ start: loc.start, end: loc.start + Math.max(loc.length, 1) }];
          if (c.state === "prepared") return [];
          const region = regionBetween(raw.content, c.context);
          const where = changeSection(raw.content, c, this.slugMapFor(c));
          if (where.kind === "section") {
            if (region && region.start >= where.range.start && region.end <= where.range.end) return [{ ...region, lost: c }];
            return [{ ...where.range, lost: c }];
          }
          if (region) return [{ ...region, lost: c }];
          unlocated = c;
          return [];
        });
        if (unlocated) {
          errors.push({ opId: group[0]!.opId, reason: `A change awaiting a decision in this note (“${summarise(unlocated)}”) can no longer be located, so Nexus cannot tell which lines it covers. Decide it first.` });
          continue;
        }
        const blockers = group.map((_, i) => {
          const l = result.located[i]!;
          return busy.find((b) => l.start < b.end && b.start < l.start + l.length);
        });
        const clash = blockers.findIndex((b) => b !== undefined);
        if (clash >= 0) {
          const lost = blockers[clash]!.lost;
          errors.push({ opId: group[clash]!.opId, reason: lost
            ? `A change awaiting a decision here (“${summarise(lost)}”) can no longer be located, so Nexus cannot tell which of these lines it covers. Decide it first.`
            : "These lines have another change awaiting review. Accept or reject it first." });
          continue;
        }
        files.push({ path: rel, beforeHash: raw.revision, afterHash: sha256(result.content), state: "planned", error: null });
        group.forEach((o, i) => changes.push(mkChange(o, { before: edits[i]!.before, after: edits[i]!.after, context: result.placed[i]!.context, scope: o.scope ?? null })));
      }

      // Records: one issues.json entry for the whole run. Order: new issues, field edits, links.
      const recordOps = fresh.filter((o): o is Extract<ProposedOperation, { kind: "record.updateField" }> => o.kind === "record.updateField");
      const createOps = fresh.filter((o): o is Extract<ProposedOperation, { kind: "record.create" }> => o.kind === "record.create" && created.has(o.opId));
      const linkOps = fresh.filter((o): o is Extract<ProposedOperation, { kind: "record.addLink" }> => o.kind === "record.addLink");
      if (recordOps.length || createOps.length || linkOps.length) {
        const bytes = await this.service.readCollectionBytes("issues");
        let next: IssuesFileT = IssuesFile.parse(JSON.parse(bytes.toString("utf8")));
        const pendingRecordChanges: ChangeRecord[] = [];
        for (const op of createOps) {
          const issue = created.get(op.opId)!;
          next = addIssue(next, issue);
          pendingRecordChanges.push(mkChange(op, { target: { recordId: issue.id, recordKey: issue.key, field: null }, file: ISSUES, baseRevision: 0, before: null, after: issue }));
        }
        for (const op of recordOps) {
          const issue = next.issues.find((i) => i.key === op.recordKey);
          if (!issue) { errors.push({ opId: op.opId, reason: `Issue not found: ${op.recordKey}` }); continue; }
          if (openCreates.has(issue.id)) { errors.push({ opId: op.opId, reason: stillProposed(issue.key) }); continue; }
          if (open.some((c) => c.kind === "record.updateField" && c.target.recordId === issue.id && c.target.field === op.field)) {
            errors.push({ opId: op.opId, reason: `${issue.key} ${op.field} already has a change awaiting review. Accept or reject it first.` }); continue;
          }
          const baseIssue = IssuesFile.parse(JSON.parse(bytes.toString("utf8"))).issues.find((i) => i.id === issue.id)!;
          if (baseIssue.revision !== op.baseRevision) { errors.push({ opId: op.opId, reason: `${op.recordKey} changed after this edit was proposed.` }); continue; }
          if (!sameValue(issue[op.field], op.before)) { errors.push({ opId: op.opId, reason: `${op.recordKey} ${op.field} no longer has the expected value.` }); continue; }
          if (!validFieldValue(issue, op.field, op.after)) { errors.push({ opId: op.opId, reason: `The new ${op.field} is not valid.` }); continue; }
          next = setField(next, issue.id, op.field, op.after, createdAt);
          pendingRecordChanges.push(mkChange(op, { target: { recordId: issue.id, recordKey: issue.key, field: op.field }, file: ISSUES }));
        }
        for (const op of linkOps) {
          const ref = op.issueRef ? created.get(op.issueRef) : undefined;
          if (op.issueRef && !ref) { errors.push({ opId: op.opId, reason: `The link refers to an issue this proposal does not create: ${op.issueRef}` }); continue; }
          const issue = ref ?? next.issues.find((i) => i.key === op.recordKey);
          if (!issue) { errors.push({ opId: op.opId, reason: `Issue not found: ${op.recordKey ?? "(none given)"}` }); continue; }
          if (!ref && openCreates.has(issue.id)) { errors.push({ opId: op.opId, reason: stillProposed(issue.key) }); continue; }
          if (!ref && op.baseRevision !== undefined && issuesNow.issues.find((i) => i.id === issue.id)?.revision !== op.baseRevision) {
            errors.push({ opId: op.opId, reason: `${issue.key} changed after this link was proposed.` }); continue;
          }
          let link = op.link;
          try {
            const raw = await this.service.readNoteRaw(op.link.notePath);
            if (!raw) throw new NexusError("NOT_FOUND", `Note not found: ${op.link.notePath}`);
            const heading = op.link.headingSlug === null ? null : parseHeadings(raw.content).find((h) => h.slug === op.link.headingSlug);
            if (op.link.headingSlug !== null && !heading) throw new NexusError("VALIDATION", `Heading not found in ${raw.rel}: ${op.link.headingSlug}`);
            link = { notePath: raw.rel, headingSlug: heading?.slug ?? null, headingText: heading?.text ?? null };
          } catch (e) { errors.push({ opId: op.opId, reason: (e as Error).message }); continue; }
          const current = next.issues.find((i) => i.id === issue.id)!;
          if (hasLink(current, link)) { errors.push({ opId: op.opId, reason: `${issue.key} already links to that note or heading.` }); continue; }
          next = addLink(next, issue.id, link, createdAt);
          if (op.issueRef) opDeps.set(op.opId, [op.issueRef]);
          pendingRecordChanges.push(mkChange(op, { target: { recordId: issue.id, recordKey: issue.key, field: null }, file: ISSUES, baseRevision: current.revision, before: null, after: link }));
        }
        if (pendingRecordChanges.length) {
          files.push({ path: ISSUES, beforeHash: sha256(bytes), afterHash: sha256(serialise(IssuesFile, next)), state: "planned", error: null });
          changes.push(...pendingRecordChanges);
        }
      }

      // A correction has one operation, so its own reason is the message the model reads.
      if (errors.length) throw new NexusError("VALIDATION", corrected && errors.length === 1 ? errors[0]!.reason : "Some proposed changes could not be applied. Nothing was written.", errors);

      // Dependencies between operations become dependencies between changes (architecture 7.1).
      const changeOf = new Map(changes.map((c) => [c.opId, c.changeId]));
      for (const c of changes) {
        const deps = opDeps.get(c.opId) ?? [];
        const missing = deps.filter((d) => !changeOf.has(d));
        if (missing.length) throw new NexusError("VALIDATION", "Some proposed changes could not be applied. Nothing was written.", [{ opId: c.opId, reason: `It depends on an operation that is not in this proposal: ${missing.join(", ")}` }]);
        c.dependsOn = deps.map((d) => changeOf.get(d)!);
      }

      const run: ReviewRun = {
        schemaVersion: 1, runId: newId("run"),
        source: { kind: source.kind, label: source.label, conversationId: source.conversationId ?? null, model: source.model ?? null },
        createdAt, phase: "prepared", files, changes,
      };
      // Reserve the new issues' numbers first. A crash after this leaves only a gap in the
      // numbering; it can never give a proposal's key to a different issue later (R4-7).
      if (created.size) await this.service.reserveIssueNumbersUnlocked([...created.values()]);
      this.runs.set(run.runId, run);
      await this.persist(run); // the journal exists before any workspace file is touched (R-C1)
      faultPoint("review:after-journal");
      await this.applyRun(run, by);
      // Only now that the correction exists in its own journal, and only once it can be reviewed,
      // is the rejected change superseded (architecture 7.4, R6-3). A correction whose write did
      // not happen leaves it rejected, with the correction unwritten. A crash in between is
      // completed by recovery.
      if (corrected) {
        faultPoint("review:before-supersede");
        await this.settleCorrections();
      }
      this.publish({ type: "review.updated" });
      return this.outcome(run, duplicates);
    });
  }

  private supersede(run: ReviewRun, change: ChangeRecord, by: string[]): void {
    this.mark(run, change, "superseded", "agent", `corrected by ${by.join(", ")}`);
    change.correction = { state: "proposed", askRunId: change.correction?.askRunId ?? null, conversationId: change.correction?.conversationId ?? null, at: now(), message: null };
  }

  /**
   * Bring every rejected change's correction in line with its corrections (the changes that
   * supersede it), and save what changed (R6-3):
   * - a correction that reached review (it was written): the change is superseded;
   * - one still waiting to be written (a failed file): the correction is `unwritten`;
   * - corrections all discarded unwritten: the correction `failed`, so Retry is offered again.
   * At start-up (`startUp`), a correction left queued or running by a stopped process failed too.
   * Callers hold `exclusive`.
   */
  private async settleCorrections(startUp = false): Promise<void> {
    const children = new Map<string, ChangeRecord[]>();
    for (const { change } of this.allChanges()) if (change.supersedes) children.set(change.supersedes, [...(children.get(change.supersedes) ?? []), change]);
    const touched = new Set<ReviewRun>();
    for (const { run, change } of this.allChanges()) {
      if (change.state !== "rejected") continue;
      const kids = children.get(change.changeId) ?? [];
      const c = change.correction ?? null;
      const set = (state: Correction["state"], message: string | null) => {
        change.correction = { state, askRunId: c?.askRunId ?? null, conversationId: c?.conversationId ?? run.source.conversationId, at: now(), message };
        touched.add(run);
      };
      if (kids.some(reviewable)) {
        this.supersede(run, change, kids.map((k) => k.changeId));
        touched.add(run);
        this.log("review: a correction can be reviewed, so the change it corrects is superseded");
        continue;
      }
      const waiting = kids.filter((k) => k.state === "prepared");
      if (waiting.length) {
        if (c?.state !== "unwritten") {
          const error = this.find(waiting[0]!.changeId).run.files.find((f) => f.path === waiting[0]!.file)?.error;
          set("unwritten", `The corrected change was not written${error ? `: ${error}` : ""}. Use Retry writing or Discard in the review bar.`);
        }
        continue;
      }
      if (kids.length && c?.state === "unwritten") {
        set("failed", "The corrected change was never written, and was discarded. Retry the correction from your reason, or keep the change rejected.");
        continue;
      }
      if (startUp && c?.state === "running") set("failed", "Nexus stopped before the correction finished.");
      else if (startUp && c?.state === "queued") set("failed", "Nexus stopped before the correction started.");
    }
    for (const run of touched) await this.persist(run);
  }

  /** Why these operations are not a correction of `change` (R6-4), or null when they are. */
  private outsideCorrection(change: ChangeRecord, ops: ProposedOperation[]): string | null {
    const issue = change.target.recordKey ?? "the issue";
    const target = change.kind === "record.updateField" ? `the ${change.target.field} of ${issue}` : `the lines of the rejected change in ${change.file}`;
    const refuse = `A correction may change only ${target}. Nexus wrote nothing. Propose one change to that target, or call final_answer.`;
    if (ops.length !== 1 || ops[0]!.kind !== change.kind) return refuse;
    const op = ops[0]!;
    if (op.kind === "record.updateField") {
      const holder = this.service.listIssues().find((i) => i.key === op.recordKey);
      return holder?.id === change.target.recordId && op.field === change.target.field ? null : refuse;
    }
    if (op.kind === "note.replaceSpan") {
      try { return this.service.notePath(op.file).rel === change.file ? null : refuse; } catch { return refuse; }
    }
    return refuse;
  }

  /**
   * Where a rejected note change's original lines are now, found by the same identity rules as a
   * reversal, in the change's own section (R6-1): the region a correction may change (R6-4).
   */
  correctionRegion(content: string, change: ChangeRecord): { start: number; end: number } | null {
    if (change.kind !== "note.replaceSpan" || String(change.before ?? "") === "") return null;
    const loc = locateChange(content, { before: change.after, after: change.before, context: change.context, scope: change.scope ?? null }, this.slugMapFor(change));
    return loc.status === "ok" ? { start: loc.start, end: loc.start + Math.max(loc.length, 1) } : null;
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
      for (const c of changes) {
        const applied = applyRecordChange(next, c, at);
        if (!applied.ok) throw new NexusError("INTERNAL", `Recomputed issues do not match the journal: ${applied.why}.`);
        next = applied.file;
      }
      if (sha256(serialise(IssuesFile, next)) !== file.afterHash) throw new NexusError("INTERNAL", "Recomputed issues do not match the journal.");
      return { kind: "issues", value: next };
    }
    const raw = await this.service.readNoteRaw(file.path);
    if (!raw || raw.revision !== file.beforeHash) return { kind: "changed" };
    const edits = scopedEdits(raw.content, changes);
    const result = edits.ok ? applyEdits(raw.content, edits.edits) : null;
    if (!result?.ok || sha256(result.content) !== file.afterHash) throw new NexusError("INTERNAL", `Recomputed ${file.path} does not match the journal.`);
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
        const applied = applyRecordChange(next, c, at);
        if (!applied.ok) { conflict(c, `retry: ${applied.why}`); continue; }
        next = applied.file;
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
      // A scoped edit whose section has changed since it was read cannot be retried (R4-1).
      const edits = scopedEdits(raw.content, candidates);
      if (!edits.ok) {
        const bad = candidates[edits.index]!;
        conflict(bad, "retry: the section has changed since it was read");
        candidates = candidates.filter((c) => c !== bad);
        continue;
      }
      const result = applyEdits(raw.content, edits.edits);
      // As for a proposal: an Edit change's new lines must be the only copy in their section (R6-1).
      const repeated = result.ok ? candidates.findIndex((c, i) => !!c.scope
        && !uniqueInSection(result.content, { before: c.before, after: c.after, context: result.placed[i]!.context, scope: c.scope }, result.placed[i]!.start)) : -1;
      if (repeated >= 0) {
        const bad = candidates[repeated]!;
        conflict(bad, "retry: the new lines would repeat other lines of the section");
        candidates = candidates.filter((c) => c !== bad);
        continue;
      }
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
      await this.settleCorrections(); // a correction written now supersedes its change (R6-3)
      this.publish({ type: "review.updated" });
      return this.outcome(run);
    });
  }

  /**
   * Drop the changes of every outstanding file without writing. Successful sibling changes are
   * untouched, except those that need a dropped change (for example a note line naming a new
   * issue that was never written): those are listed and, once confirmed with `withDependents`,
   * rejected and undone first (R4-3). Idempotent.
   */
  async discard(runId: string, opts: { withDependents?: boolean } = {}): Promise<RunOutcome> {
    return this.service.exclusive(async () => {
      const run = this.runs.get(runId);
      if (!run) throw new NexusError("NOT_FOUND", "That review run does not exist.");
      const failed = run.files.filter((f) => f.state === "failed");
      if (failed.length === 0) return this.outcome(run);
      const dropped = run.changes.filter((c) => failed.some((f) => f.path === c.file) && c.state === "prepared");
      const dependents = uniqueChanges(dropped.flatMap((c) => this.openDependents(c))).filter((d) => !dropped.includes(d));
      if (dependents.length && !opts.withDependents) {
        throw new NexusError("CONFLICT", "Other changes need the changes being discarded. Discarding also rejects and undoes them.", {
          reason: "has-dependents", changes: dependents.map((d) => ({ changeId: d.changeId, summary: summarise(d) })),
        });
      }
      if (dependents.length) await this.decideGroup("reject", dependents, "rejected because the change it needs was discarded");
      for (const file of failed) {
        file.state = "discarded";
        for (const c of run.changes.filter((c) => c.file === file.path && c.state === "prepared")) {
          this.mark(run, c, "rejected", "user", "discarded: never written to the file");
        }
      }
      this.settlePhase(run);
      await this.persist(run);
      await this.settleCorrections(); // a discarded correction leaves its change open to Retry (R6-3)
      this.publish({ type: "review.updated" });
      return this.outcome(run);
    });
  }
  // ---------------- Decisions ----------------

  /** Every change this one depends on, transitively, whatever its state. */
  private dependencies(change: ChangeRecord): ChangeRecord[] {
    const out: ChangeRecord[] = [];
    const visit = (c: ChangeRecord) => {
      for (const id of c.dependsOn) {
        const dep = this.allChanges().find((x) => x.change.changeId === id)?.change;
        if (dep && !out.includes(dep)) { out.push(dep); visit(dep); }
      }
    };
    visit(change);
    return out;
  }

  /**
   * Whether what a dependency provides is really in the files now: it was accepted, or it is a
   * new issue that the user kept after a conflict ("Keep current version"), so it still exists.
   */
  private stands(dep: ChangeRecord): boolean {
    if (dep.state === "accepted") return true;
    if (dep.kind === "record.create" && dep.state === "rejected") return this.service.listIssues().some((i) => i.id === dep.target.recordId);
    return false;
  }

  /**
   * Whether a pending change's own target is still in the files: its issue, and its link (R5-2).
   * With `content` (a group decision, also when recovery completes one), what it proposed must be
   * there too (R6-2): a note change's new lines, found by the same rules as a reversal, and a
   * field's proposed value. A note deletion leaves no lines to look for, so it is not checked.
   */
  private async present(change: ChangeRecord, content: boolean): Promise<{ ok: true } | { ok: false; reason: "missing" | "ambiguous" | "changed" }> {
    if (change.kind === "note.replaceSpan") {
      if (!content || String(change.after ?? "") === "") return { ok: true };
      const raw = await this.service.readNoteRaw(change.file).catch(() => null);
      if (!raw) return { ok: false, reason: "missing" };
      const loc = this.locateNoteChange(raw.content, change);
      return loc.status === "ok" ? { ok: true } : { ok: false, reason: loc.status };
    }
    const issue = this.service.listIssues().find((i) => i.id === change.target.recordId);
    if (!issue) return { ok: false, reason: "missing" };
    if (change.kind === "record.addLink" && !hasLink(issue, change.after as NoteLink)) return { ok: false, reason: "missing" };
    if (change.kind === "record.updateField" && content && !sameValue(issue[change.target.field!], change.after)) return { ok: false, reason: "changed" };
    return { ok: true };
  }

  /** Open changes that depend on this one, transitively, most dependent first (for rejection). */
  private openDependents(change: ChangeRecord): ChangeRecord[] {
    const out: ChangeRecord[] = [];
    const visit = (c: ChangeRecord) => {
      for (const { change: d } of this.allChanges()) {
        if (d.dependsOn.includes(c.changeId) && OPEN_STATES.includes(d.state) && !out.includes(d)) { visit(d); out.push(d); }
      }
    };
    visit(change);
    return out;
  }

  /**
   * Accept a change. Every change it depends on must really be in the files:
   * - one that was never written, was rejected or is in conflict blocks it, whatever the user
   *   confirms (R4-3);
   * - one still pending must be accepted with it: without `withDependencies` this is refused with
   *   the list, so the UI can offer "Accept both" (architecture 7.4).
   */
  async accept(changeId: string, opts: { withDependencies?: boolean } = {}): Promise<ChangeView> {
    return this.service.exclusive(async () => {
      const { change } = this.find(changeId);
      if (change.state === "accepted") return this.viewOf(changeId);
      if (change.state !== "pending") throw new NexusError("CONFLICT", `This change is ${change.state} and cannot be accepted.`);
      const deps = this.dependencies(change).filter((d) => !this.stands(d));
      const blocked = deps.filter((d) => d.state !== "pending");
      if (blocked.length) {
        const why = (d: ChangeRecord) => d.state === "prepared" ? "was never written (use Retry or Discard)" : d.state === "conflicted" ? "is in conflict (decide it first)" : "was rejected";
        throw new NexusError("CONFLICT", `This change needs ${blocked.map((d) => `“${summarise(d)}”, which ${why(d)}`).join("; ")}. It cannot be accepted on its own.`, {
          reason: "dependency-unavailable", changes: blocked.map((d) => ({ changeId: d.changeId, summary: summarise(d), state: d.state })),
        });
      }
      if (deps.length && !opts.withDependencies) {
        throw new NexusError("CONFLICT", "This change depends on another change that is still awaiting review. Accept them together.", {
          reason: "needs-dependencies", changes: deps.map((d) => ({ changeId: d.changeId, summary: summarise(d) })),
        });
      }
      // Prerequisites first, so that no accepted change ever needs one that is not.
      await this.decideGroup("accept", [...deps.reverse(), change], `accepted with ${change.changeId}`);
      return this.viewOf(changeId);
    });
  }

  /**
   * Carry out a decision on several related changes, in order. When there is more than one, the
   * decision is saved on each of them first, so that recovery finishes it after a crash part-way
   * through (R4-9). Callers must hold `exclusive`.
   */
  private async decideGroup(action: "accept" | "reject", members: ChangeRecord[], note: string): Promise<void> {
    const at = now();
    const group = members.map((m) => m.changeId);
    const owners = () => [...new Set(members.map((m) => this.find(m.changeId).run))];
    const clearDecision = async () => {
      for (const m of members) m.decision = null;
      for (const run of owners()) await this.persist(run);
    };
    // Check the decision against the files as they are now, also when recovery finishes one
    // that was saved before a crash and the files were edited while Nexus was closed (R5-2).
    if (action === "accept") {
      // A change whose issue or link is no longer in the files cannot be accepted, and nothing
      // that needs it is accepted either.
      // In a group, each member's own content is checked as well (R6-2): a note line replaced by
      // hand is not accepted as if the proposed line were there, and the issue and link it was
      // to be accepted with stay pending for the user.
      const gone: Array<{ m: ChangeRecord; reason: "missing" | "ambiguous" | "changed" }> = [];
      for (const m of members) {
        if (m.state !== "pending") continue;
        const p = await this.present(m, members.length > 1);
        if (!p.ok) gone.push({ m, reason: p.reason });
      }
      if (gone.length) {
        for (const { m, reason } of gone) {
          m.conflictReason = reason;
          this.mark(this.find(m.changeId).run, m, "conflicted", "system", "no longer in the files as proposed, so it cannot be accepted");
        }
        await clearDecision();
        this.publish({ type: "review.updated" });
        const names = gone.map(({ m }) => `“${summarise(m)}”`).join(" and ");
        throw new NexusError("CONFLICT", `${names} ${gone.length === 1 ? "is" : "are"} no longer in the files as proposed, so nothing was accepted. Decide ${gone.length === 1 ? "it" : "them"} first.`, {
          reason: "target-missing", changes: gone.map(({ m }) => ({ changeId: m.changeId, summary: summarise(m) })),
        });
      }
    } else {
      // A change that others in the group depend on, and that can no longer be undone (someone
      // has worked on it since), becomes a conflict; the changes that depend on it stay as they
      // are, as with an ordinary rejection, so the user can still resolve them.
      for (const m of members) {
        if (m.state !== "pending") continue;
        const needsIt = members.filter((d) => d !== m && OPEN_STATES.includes(d.state) && this.dependencies(d).includes(m));
        if (needsIt.length && !(await this.reversible(m, needsIt))) {
          await clearDecision();
          await this.rejectOne(m.changeId, null);
          return;
        }
      }
    }
    if (members.length > 1) {
      for (const m of members) m.decision = { action, group, at };
      for (const run of owners()) await this.persist(run);
      faultPoint("review:after-group-decision");
    }
    const last = members[members.length - 1]!;
    for (const m of members) {
      const owner = this.find(m.changeId).run;
      const memberNote = m === last ? null : note;
      if (action === "accept") {
        if (m.state === "pending") {
          await this.recordAcceptMoves(m);
          this.mark(owner, m, "accepted", "user", memberNote);
          await this.persist(owner);
        }
      } else if (m.state === "pending") {
        await this.rejectOne(m.changeId, memberNote);
      } else if (m.state === "conflicted" && m !== last) {
        this.mark(owner, m, "rejected", "user", "closed: the change it depends on was rejected");
        await this.persist(owner);
      }
    }
    if (members.length > 1) {
      for (const m of members) m.decision = null;
      for (const run of owners()) await this.persist(run);
    }
    this.publish({ type: "review.updated" });
  }

  /** On accepting a note edit, record how the accepted heading slugs move, for saved citations (R4-8). */
  private async recordAcceptMoves(change: ChangeRecord): Promise<void> {
    if (change.kind !== "note.replaceSpan") return;
    const raw = await this.service.readNoteRaw(change.file).catch(() => null);
    if (!raw) return;
    const before = this.acceptedText(raw.content, change.file, []);
    const after = this.acceptedText(raw.content, change.file, [change.changeId]);
    const moves = slugMoves(before, after);
    if (moves.length) change.slugMoves = { ref: "accepted", at: now(), moves };
  }

  /**
   * The accepted text of a note: its text on disk with the edits still awaiting a decision
   * undone, newest first, except those in `asAccepted`.
   */
  acceptedText(content: string, path: string, asAccepted: string[]): string {
    let text = content;
    const open = this.unsettledChanges().filter((c) => c.kind === "note.replaceSpan" && c.file === path && (c.state === "pending" || c.state === "conflicted") && !asAccepted.includes(c.changeId));
    for (const c of open.reverse()) {
      const loc = this.locateNoteChange(text, c);
      if (loc.status === "ok") text = splice(text, loc.start, loc.length, String(c.before));
    }
    return text;
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
      // A running or finished correction keeps the reason it was given; a second send of the
      // same reason, or a send from another tab, changes nothing (PRD-064).
      if (change.correction && HOLDING_CORRECTION.includes(change.correction.state)) return this.viewOf(changeId);
      change.feedback = { text, at: now() };
      // For a change a reason can correct, the request is saved with the reason, so a crash
      // before its run starts still leaves something to retry (R6-7). Skip saves nothing at all.
      if (change.state === "rejected" && correctable(run, change)) {
        change.correction = { state: "queued", askRunId: null, conversationId: run.source.conversationId, at: now(), message: null };
      }
      await this.persist(run);
      this.publish({ type: "review.updated" });
      return this.viewOf(changeId);
    });
  }

  /**
   * Start the correction of a rejected change, once. Refused (started: false) unless the change
   * is rejected, has a reason, and has no running or proposed correction.
   */
  async beginCorrection(changeId: string, askRunId: string, conversationId: string | null): Promise<{ started: boolean; view: ChangeView }> {
    return this.service.exclusive(async () => {
      const { run, change } = this.find(changeId);
      const busy = !!change.correction && HOLDING_CORRECTION.includes(change.correction.state);
      if (change.state !== "rejected" || !change.feedback || busy || !correctable(run, change)) return { started: false, view: await this.viewOf(changeId) };
      change.correction = { state: "running", askRunId, conversationId, at: now(), message: null };
      await this.persist(run);
      this.publish({ type: "review.updated" });
      return { started: true, view: await this.viewOf(changeId) };
    });
  }

  /**
   * Record how a correction ended without a proposal: no-change or failed. Only the run that
   * holds the correction may end it; askRunId null records a correction that could not start.
   */
  async endCorrection(changeId: string, askRunId: string | null, outcome: { state: "no-change" | "failed"; message: string }): Promise<ChangeView> {
    return this.service.exclusive(async () => {
      const { run, change } = this.find(changeId);
      const c = change.correction;
      const holds = askRunId === null ? !(c && HOLDING_CORRECTION.includes(c.state)) : c?.state === "running" && c.askRunId === askRunId;
      if (change.state === "rejected" && holds) {
        change.correction = { state: outcome.state, askRunId, conversationId: c?.conversationId ?? run.source.conversationId, at: now(), message: outcome.message.slice(0, 500) };
        await this.persist(run);
        this.publish({ type: "review.updated" });
      }
      return this.viewOf(changeId);
    });
  }

  /** "Keep it rejected": close a correction that failed or proposed nothing. The reason stays. */
  async dropCorrection(changeId: string): Promise<ChangeView> {
    return this.service.exclusive(async () => {
      const { run, change } = this.find(changeId);
      const c = change.correction;
      if (c && (c.state === "failed" || c.state === "no-change")) {
        change.correction = { ...c, state: "dropped", at: now() };
        await this.persist(run);
        this.publish({ type: "review.updated" });
      } else if (c?.state === "running" || c?.state === "queued") {
        throw new NexusError("CONFLICT", "The correction is still running. Wait for it, or cancel it in the conversation.", { reason: "correction-running" });
      } else if (c?.state === "unwritten") {
        throw new NexusError("CONFLICT", "The corrected change is waiting to be written. Use Retry writing or Discard in the review bar first.", { reason: "correction-unwritten" });
      }
      return this.viewOf(changeId);
    });
  }

  /** Compute the reversal of one change against the current file, or the reason it cannot be reversed. */
  private async planReversal(change: ChangeRecord, at: string):
    Promise<{ ok: true; beforeHash: string; afterHash: string; write: () => Promise<void>; note?: { before: string; after: string } } | { ok: false; reason: "missing" | "ambiguous" | "changed" }> {
    if (change.kind === "note.replaceSpan") {
      const raw = await this.service.readNoteRaw(change.file);
      if (!raw) return { ok: false, reason: "missing" };
      const loc = this.locateNoteChange(raw.content, change);
      if (loc.status !== "ok") return { ok: false, reason: loc.status };
      const content = splice(raw.content, loc.start, loc.length, String(change.before));
      return {
        ok: true, beforeHash: raw.revision, afterHash: sha256(content), note: { before: raw.content, after: content },
        write: async () => { await this.service.writeNoteUnlocked(change.file, content); },
      };
    }
    const bytes = await this.service.readCollectionBytes("issues");
    const file = IssuesFile.parse(JSON.parse(bytes.toString("utf8")));
    const issue = file.issues.find((i) => i.id === change.target.recordId);
    if (!issue) return { ok: false, reason: "missing" };
    let next: IssuesFileT;
    if (change.kind === "record.create") {
      // Undo a new issue only if nobody has worked on it since; newer work is kept.
      if (!createdUnchanged(issue, Issue.parse(change.after))) return { ok: false, reason: "changed" };
      next = removeIssue(file, issue.id);
    } else if (change.kind === "record.addLink") {
      if (!hasLink(issue, change.after as NoteLink)) return { ok: false, reason: "missing" };
      next = removeLink(file, issue.id, change.after as NoteLink, at);
    } else {
      if (!sameValue(issue[change.target.field!], change.after)) return { ok: false, reason: "changed" };
      next = setField(file, issue.id, change.target.field!, change.before, at);
    }
    return { ok: true, beforeHash: sha256(bytes), afterHash: sha256(serialise(IssuesFile, next)), write: async () => { await this.service.writeCollectionUnlocked("issues", IssuesFile, next); } };
  }

  /**
   * Reject a change, reversing only its own region. Changes that depend on it (for example the
   * link to and the note mention of a new issue) are rejected first, but only once the user has
   * confirmed the list: without `withDependents` this is refused with that list (D-C1, PRD-063).
   */
  async reject(changeId: string, opts: { withDependents?: boolean } = {}): Promise<ChangeView> {
    return this.service.exclusive(async () => {
      const { change } = this.find(changeId);
      if (["rejected", "superseded", "conflicted"].includes(change.state)) return this.viewOf(changeId);
      if (change.state !== "pending") throw new NexusError("CONFLICT", `This change is ${change.state} and cannot be rejected.`);
      const dependents = this.openDependents(change);
      if (dependents.length && !opts.withDependents) {
        throw new NexusError("CONFLICT", "Other changes depend on this one. Rejecting it also rejects them.", {
          reason: "has-dependents", changes: dependents.map((d) => ({ changeId: d.changeId, summary: summarise(d) })),
        });
      }
      // If the change itself cannot be undone (for example a new issue someone has edited since),
      // it becomes a conflict and its dependents are left as they are, rather than undone for nothing.
      if (dependents.length && !(await this.reversible(change, dependents))) return this.rejectOne(changeId, null);
      await this.decideGroup("reject", [...dependents, change], `rejected because ${change.changeId} was rejected`);
      return this.viewOf(changeId);
    });
  }

  /** Whether a change could be undone once the given dependents have been undone. */
  private async reversible(change: ChangeRecord, dependents: ChangeRecord[]): Promise<boolean> {
    if (change.kind !== "record.create") return (await this.planReversal(change, now())).ok;
    const issue = this.service.listIssues().find((i) => i.id === change.target.recordId);
    if (!issue) return false;
    const added = dependents.filter((d) => d.kind === "record.addLink" && d.target.recordId === issue.id).map((d) => d.after as NoteLink);
    const withoutAdded = { ...issue, noteLinks: issue.noteLinks.filter((l) => !added.some((a) => a.notePath === l.notePath && a.headingSlug === l.headingSlug)) };
    return createdUnchanged(withoutAdded, Issue.parse(change.after));
  }

  /** Reverse one pending change. Callers must hold `exclusive`. */
  private async rejectOne(changeId: string, note: string | null): Promise<ChangeView> {
    {
      const { run, change } = this.find(changeId);
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
      // Heading slugs on disk that the reversal moves, for heading links saved meanwhile (R4-8).
      const moves = plan.note ? slugMoves(plan.note.before, plan.note.after) : [];
      if (moves.length) change.slugMoves = { ref: "disk", at, moves };
      this.mark(run, change, "rejecting", "user");
      await this.persist(run); // reversal intent is durable before the file changes
      faultPoint("review:after-reversal-journal");
      await plan.write();
      faultPoint("review:after-reversal-write");
      this.mark(run, change, "rejected", "user", note);
      await this.persist(run);
      this.publish({ type: "review.updated" });
      return this.viewOf(changeId);
    }
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
      // A correction journaled while the change it corrects was not yet superseded (a crash
      // between the two journal writes): supersede it now. A correction still running belongs to
      // a process that stopped: it failed, and its reason stays for Retry (PRD-064).
      // A correction is superseding only once it can be reviewed, so an unwritten one leaves its
      // change rejected and unwritten (R6-3); a reason saved just before a crash becomes a failed
      // correction to retry (R6-7).
      await this.settleCorrections(true);
      // A group decision the user confirmed, interrupted part-way: finish it in its saved order.
      // A member that cannot be undone any more becomes a conflict, which explains what is
      // outstanding; nothing is guessed (R4-9).
      const groups = new Map<string, { action: "accept" | "reject"; members: ChangeRecord[] }>();
      for (const { change } of this.allChanges()) {
        if (!change.decision) continue;
        const key = change.decision.group.join(",");
        if (!groups.has(key)) {
          const members = change.decision.group.map((id) => this.allChanges().find((x) => x.change.changeId === id)?.change).filter((c): c is ChangeRecord => !!c);
          groups.set(key, { action: change.decision.action, members });
        }
      }
      for (const { action, members } of groups.values()) {
        this.log(`review: completing an interrupted decision to ${action} ${members.length} changes`);
        try {
          await this.decideGroup(action, members, `recovered: completing the confirmed decision to ${action} ${members.length} related changes`);
        } catch (e) {
          // The files changed while Nexus was closed: the members are left for the user to decide.
          this.log(`review: an interrupted decision could not be completed: ${(e as Error).message.slice(0, 160)}`);
        }
      }
      // Keys that a journal ever gave a proposed issue stay used, also in a workspace from before
      // run 5, which did not reserve them in projects.json (R5-7).
      const proposed = this.allChanges().filter(({ change }) => change.kind === "record.create").map(({ change }) => Issue.safeParse(change.after)).flatMap((r) => (r.success ? [r.data] : []));
      if (proposed.length) {
        try { await this.service.reserveIssueNumbersUnlocked(proposed); } catch (e) { this.log(`review: could not reserve proposed issue keys: ${(e as Error).message.slice(0, 120)}`); }
      }
    });
  }
}

const uniqueChanges = (list: ChangeRecord[]) => list.filter((c, i) => list.indexOf(c) === i);

/**
 * The lines between a change's saved neighbouring lines, when each neighbour is found exactly
 * once and in order (the start or end of the note stands in for a missing neighbour). Used
 * for a change whose own lines can no longer be found (R5-9).
 */
function regionBetween(content: string, context: ChangeRecord["context"]): { start: number; end: number } | null {
  if (!context) return null;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const only = (text: string | null, fallback: number) => {
    if (text === null) return fallback;
    const at = lines.flatMap((l, i) => (l === text ? [i] : []));
    return at.length === 1 ? at[0]! : null;
  };
  const before = only(context.lineBefore, -1);
  const after = only(context.lineAfter, lines.length);
  if (before === null || after === null || after <= before) return null;
  return { start: before + 1, end: Math.max(after, before + 2) };
}

/** Note edits with their section ranges; a scope whose text no longer matches is reported by index. */
function scopedEdits(content: string, changes: ChangeRecord[]): { ok: true; edits: SpanEdit[] } | { ok: false; index: number } {
  const headings = parseHeadings(content);
  const edits: SpanEdit[] = [];
  for (const [index, c] of changes.entries()) {
    const edit: SpanEdit = { before: String(c.before), after: String(c.after) };
    if (c.scope) {
      const s = scopeOf(content, c.scope.headingSlug, headings, c.scope.lines);
      if (!s || sha256(s.text) !== c.scope.sectionHash) return { ok: false, index };
      edit.range = s.range;
    }
    edits.push(edit);
  }
  return { ok: true, edits };
}

function firstLine(value: unknown): string {
  const s = String(value ?? "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

function summarise(change: ChangeRecord): string {
  if (change.kind === "note.replaceSpan") return `${change.file}: “${firstLine(change.before)}” → “${firstLine(change.after)}”`;
  if (change.kind === "record.create") return `New issue ${change.target.recordKey}: ${(change.after as { title?: string })?.title ?? ""}`;
  if (change.kind === "record.addLink") {
    const l = change.after as NoteLink;
    return `${change.target.recordKey} link to ${l.notePath.replace(/\.md$/i, "")}${l.headingText ? ` › ${l.headingText}` : ""}`;
  }
  const show = (v: unknown) => (v && typeof v === "object" && "date" in (v as object) ? String((v as { date: string }).date) : v === null ? "none" : canonical(v).replace(/^"|"$/g, ""));
  return `${change.target.recordKey} ${change.target.field}: ${show(change.before)} → ${show(change.after)}`;
}
