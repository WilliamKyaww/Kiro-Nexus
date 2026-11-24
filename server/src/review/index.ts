// Wires the review engine into the service lifecycle and HTTP API.
import type { FastifyInstance } from "fastify";
import { FeedbackRequest, type ProposedOperation } from "@nexus/schema";
import type { RouteContext } from "../app";
import { NexusError } from "../errors";
import { dueReminders, effectiveAcceptedIssues } from "../scheduler/reminders";
import type { AppState } from "../state";
import type { WorkspaceService } from "../workspace/service";
import { ReviewEngine } from "./engine";

const engines = new WeakMap<AppState, ReviewEngine>();

export function installReview(state: AppState): void {
  state.onOpen.push(async (service) => {
    engines.set(state, await ReviewEngine.load(service, (e) => state.publish(e), state.log));
  });
  state.onClose.push(async () => { engines.delete(state); });
}

export function requireEngine(state: AppState): ReviewEngine {
  const engine = engines.get(state);
  if (!engine || !state.service) throw new NexusError("NO_WORKSPACE", "No workspace is open.");
  return engine;
}

export const DEMO_LABEL = "Demo operations (fixed, not AI)";
export const DEMO_NOTE = "meetings/2026-11-24 kickoff.md";

/** The fixed, labelled demo run used before an LLM issues operations (R-D-B). */
export async function demoOperations(service: WorkspaceService): Promise<ProposedOperation[]> {
  const raw = await service.readNoteRaw(DEMO_NOTE);
  const issue = service.listIssues().find((i) => i.key === "NEX-1");
  if (!raw || !issue) throw new NexusError("NOT_FOUND", "The demo needs the sample workspace (the kickoff note and NEX-1). Copy the sample from the Workspace page.");
  return [
    { opId: "demo-1-note-checklist", kind: "note.replaceSpan", file: DEMO_NOTE, baseRevision: raw.revision,
      before: "- [ ] Hein builds the calendar view\n", after: "- [x] Hein builds the calendar view\n" },
    { opId: "demo-1-nex1-due", kind: "record.updateField", file: ".nexus/issues.json", recordKey: "NEX-1", field: "due",
      baseRevision: issue.revision, before: issue.due, after: { date: "2026-12-03" } },
  ];
}

export function reviewRoutes(state: AppState) {
  return (app: FastifyInstance, ctx: RouteContext) => {
    app.get("/api/v1/review/changes", async (request) => {
      const filter = (request.query as { state?: string }).state === "all" ? "all" : "open";
      return { changes: await requireEngine(state).views(filter) };
    });
    app.post("/api/v1/review/demo", async () => {
      const service = state.requireService();
      return requireEngine(state).propose({ kind: "fixed-demo", label: DEMO_LABEL }, await demoOperations(service), "demo");
    });
    const id = (request: { params: unknown }) => (request.params as { id: string }).id;
    app.get("/api/v1/review/runs/incomplete", async () => ({ runs: await requireEngine(state).incompleteRuns() }));
    app.get("/api/v1/review/heading-aliases", async (request) => {
      const path = String((request.query as { path?: string }).path ?? "");
      if (!path) throw new NexusError("VALIDATION", "path is required");
      const rel = state.requireService().notePath(path).rel;
      return { aliases: requireEngine(state).headingAliases(rel) };
    });
    app.post("/api/v1/review/runs/:id/retry", async (request) => requireEngine(state).retry(id(request)));
    app.post("/api/v1/review/runs/:id/discard", async (request) => requireEngine(state).discard(id(request)));
    app.post("/api/v1/review/changes/:id/accept", async (request) => requireEngine(state).accept(id(request)));
    app.post("/api/v1/review/changes/:id/reject", async (request) => requireEngine(state).reject(id(request)));
    app.post("/api/v1/review/changes/:id/keep-current", async (request) => requireEngine(state).keepCurrent(id(request)));
    app.post("/api/v1/review/changes/:id/feedback", async (request) => {
      const { text } = ctx.parse(FeedbackRequest, request.body);
      return requireEngine(state).feedback(id(request), text);
    });
    // Read-only preview of which reminders would fire at a time (B4 seam; proves PRD-066).
    app.get("/api/v1/reminders/due", async (request) => {
      const service = state.requireService();
      const atRaw = (request.query as { at?: string }).at;
      const at = atRaw ? new Date(atRaw) : new Date();
      if (Number.isNaN(at.getTime())) throw new NexusError("VALIDATION", "at must be an ISO date-time.");
      const issues = effectiveAcceptedIssues(service.listIssues(), requireEngine(state).unsettledChanges());
      return { reminders: dueReminders(issues, { at, timeZone: service.manifest.timeZone }) };
    });
  };
}
