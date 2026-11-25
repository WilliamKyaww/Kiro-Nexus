// The correction loop (PRD-064, architecture 7.4, run 6 stage 3). A reason for a rejected Edit
// change starts a correction run in Edit mode, in the change's conversation, bound to that
// change and to its target. Its proposal supersedes the rejected change once it is journaled.
import type { FastifyInstance } from "fastify";
import { FeedbackRequest, type ChangeRecord, type ChangeView } from "@nexus/schema";
import type { RouteContext } from "../app";
import { NexusError } from "../errors";
import { requireEngine } from "../review";
import type { ReviewEngine } from "../review/engine";
import type { AppState } from "../state";
import { newId, type WorkspaceService } from "../workspace/service";
import { admitConversation, releaseConversation, startRun } from "./routes";

/** Corrections being admitted right now: two simultaneous sends cannot both start a run. */
const admitting = new Set<string>();

type Target =
  | { kind: "field"; issue: string; field: string; current: unknown }
  | { kind: "note"; note: string; heading: string | null; lines: string };

const shown = (value: unknown) => JSON.stringify(value ?? null);

/**
 * The disputed target as it is now, or why a correction cannot be placed. It describes the target
 * to the model; the engine checks the write boundary itself, under the write lock (R6-4).
 */
async function targetOf(service: WorkspaceService, engine: ReviewEngine, change: ChangeRecord): Promise<Target | { error: string }> {
  if (change.kind === "record.updateField") {
    const issue = service.listIssues().find((i) => i.id === change.target.recordId);
    if (!issue || !change.target.field) return { error: "The issue this change was for no longer exists, so there is nothing to correct." };
    return { kind: "field", issue: issue.key, field: change.target.field, current: issue[change.target.field] };
  }
  const raw = await service.readNoteRaw(change.file).catch(() => null);
  if (!raw) return { error: `The note ${change.file} no longer exists, so there is nothing to correct.` };
  // After the rejection, the change's original lines are back where it was proposed, in its
  // own section (found by the same rules as a reversal, R6-1).
  if (!engine.correctionRegion(raw.content, change)) {
    return { error: "The lines this change covered were edited after it was rejected, so Nexus cannot tell where a correction belongs. Edit them by hand, or ask again in Edit." };
  }
  return { kind: "note", note: raw.rel, heading: change.scope?.headingSlug ?? null, lines: String(change.before) };
}

function describe(target: Target): string {
  return target.kind === "field"
    ? `the ${target.field} field of ${target.issue} (update_issue with issue ${target.issue} and field ${target.field}). Its value now is ${shown(target.current)}`
    : `these lines of the note ${target.note}${target.heading ? ` under the heading with slug ${target.heading}` : ""}. Read that section with read_note_section first, then use edit_note on these lines:\n${target.lines}`;
}

/** What the model receives. The reason is the user's own words; the JSON block repeats the facts. */
function correctionPrompt(view: ChangeView, change: ChangeRecord, target: Target, reason: string): string {
  const json = {
    target: target.kind === "field" ? { kind: "field", issue: target.issue, field: target.field } : { kind: "note", note: target.note, heading: target.heading, lines: target.lines },
    current: target.kind === "field" ? target.current : target.lines,
    rejected: { before: change.before, after: change.after },
    reason,
  };
  return [
    "Correct a rejected change.",
    `Nexus proposed this change, and the user rejected it: ${view.summary}.`,
    `The user's reason, in their own words: “${reason}”`,
    `Propose one corrected change with propose_changes, to this target only: ${describe(target)}.`,
    "Nexus refuses changes to anything else. If the reason does not say what the change should be, propose nothing, and call final_answer saying what you need to know.",
    `CORRECTION_REQUEST_JSON: ${JSON.stringify(json)}`,
  ].join("\n");
}

/**
 * Start the correction of a rejected change from its saved reason, or report the one already
 * running or proposed. Always answers with the change, whose `correction` says what happened.
 */
export async function startCorrection(state: AppState, changeId: string): Promise<ChangeView> {
  const engine = requireEngine(state);
  const service = state.requireService();
  const view = async () => (await engine.views("all")).find((v) => v.changeId === changeId)!;
  if (admitting.has(changeId)) return view();
  admitting.add(changeId);
  try {
    const { run, change } = engine.correctionTarget(changeId);
    const current = await view();
    if (change.state !== "rejected" || !change.feedback || !current.correctable) return current;
    if (change.correction && ["running", "unwritten", "proposed"].includes(change.correction.state)) return current;
    const reason = change.feedback.text;
    const conversationId = run.source.conversationId!;
    const fail = (message: string) => engine.endCorrection(changeId, null, { state: "failed", message });
    const target = await targetOf(service, engine, change);
    if ("error" in target) return fail(target.error);
    if (!admitConversation(conversationId)) return fail("The conversation was answering another question, so the correction did not start. Retry when it has finished.");
    let holdsSlot = true;
    try {
      const askRunId = newId("run");
      const begun = await engine.beginCorrection(changeId, askRunId, conversationId);
      if (!begun.started) return begun.view;
      try {
        await startRun(state, service, conversationId, `Correct the rejected change ${current.summary}. Reason: ${reason}`, "edit", {
          runId: askRunId,
          correction: {
            changeId,
            modelQuestion: correctionPrompt(current, change, target, reason),
            onEnd: async (id, outcome) => { await engine.endCorrection(changeId, id, outcome); },
          },
        });
        holdsSlot = false; // the run's background task releases the slot once its answer is saved
      } catch (e) {
        return await engine.endCorrection(changeId, askRunId, { state: "failed", message: (e as Error).message });
      }
      return view();
    } finally {
      if (holdsSlot) releaseConversation(conversationId);
    }
  } finally {
    admitting.delete(changeId);
  }
}

export function correctionRoutes(state: AppState) {
  return (app: FastifyInstance, rc: RouteContext) => {
    const id = (r: { params: unknown }) => (r.params as { id: string }).id;
    // The reason is saved in the journal first; for an Edit change to a field or to note lines it
    // then starts the correction. Other changes keep the reason only.
    app.post("/api/v1/review/changes/:id/feedback", async (request) => {
      const { text } = rc.parse(FeedbackRequest, request.body);
      const saved = await requireEngine(state).feedback(id(request), text);
      return saved.correctable && saved.state === "rejected" ? startCorrection(state, id(request)) : saved;
    });
    // Retry, from the saved reason.
    app.post("/api/v1/review/changes/:id/correction", async (request) => {
      const engine = requireEngine(state);
      const current = (await engine.views("all")).find((v) => v.changeId === id(request));
      if (!current) throw new NexusError("NOT_FOUND", "That change does not exist.");
      if (!current.feedback) throw new NexusError("VALIDATION", "Send a reason first: Nexus corrects a change from what you say was wrong.");
      if (!current.correctable) throw new NexusError("VALIDATION", "Nexus corrects only Edit changes to an issue field or to note lines. Your reason is saved.");
      return startCorrection(state, id(request));
    });
    app.post("/api/v1/review/changes/:id/correction/drop", async (request) => requireEngine(state).dropCorrection(id(request)));
  };
}
