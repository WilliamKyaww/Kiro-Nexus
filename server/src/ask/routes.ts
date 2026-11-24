// Ask API: availability, conversations, runs and cancellation (slice C).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteContext } from "../app";
import { NexusError } from "../errors";
import { faultDelay } from "../faults";
import { searchIndexFor } from "../notes";
import { aiContext, describeProviderError } from "../providers";
import { receivingHost } from "../providers/profiles";
import { requireEngine } from "../review";
import type { AppState } from "../state";
import { newId, type WorkspaceService } from "../workspace/service";
import { priorTurns, type PriorTurn } from "./context";
import { runAsk } from "./coordinator";
import { ConversationStore, type Conversation } from "./conversations";
import { readOnlyWorkspace } from "./workspace";

const AskRequest = z.strictObject({ question: z.string().trim().min(3).max(2000) });
const NewConversation = z.strictObject({ title: z.string().trim().max(120).optional() });

interface ActiveRun { controller: AbortController; conversationId: string; activity: string }
const runs = new Map<string, ActiveRun>();
/**
 * Conversations with a question in flight, from admission until its answer is durably saved.
 * The slot is taken synchronously, before the first await, so two simultaneous sends cannot
 * both be admitted.
 */
const busy = new Set<string>();

const busyError = () => new NexusError("CONFLICT", "This conversation is already answering a question. Wait for the answer, or cancel it, then send again.", { reason: "busy" });

export function askAvailability(state: AppState) {
  const ctx = aiContext(state);
  const p = ctx.registry.selected();
  if (!p) return { available: false as const, reason: "no-profile", message: "AI is off: no provider is set up.", profile: null };
  const profile = { id: p.id, name: p.name, model: p.model, receivingHost: receivingHost(p.baseUrl), fixture: p.capabilities.fixture, capabilities: p.capabilities };
  if (!ctx.keys.has(p.id)) return { available: false as const, reason: "no-key", message: `AI is off: add a key for ${p.name} in Settings.`, profile };
  if (p.capabilities.toolCalling !== "yes" && p.capabilities.structuredOutput !== "yes") {
    return { available: false as const, reason: "untested", message: `AI is off: test ${p.name} in Settings first.`, profile };
  }
  return { available: true as const, reason: null, message: null, profile };
}

export function askRoutes(state: AppState) {
  return (app: FastifyInstance, rc: RouteContext) => {
    const store = () => new ConversationStore(state.requireService());
    const id = (r: { params: unknown }) => (r.params as { id: string }).id;

    app.get("/api/v1/ask/status", async () => askAvailability(state));
    app.get("/api/v1/conversations", async () => ({ conversations: await store().list() }));
    app.post("/api/v1/conversations", async (request, reply) => {
      const { title } = rc.parse(NewConversation, request.body);
      return reply.code(201).send(await store().create(title ?? ""));
    });
    app.get("/api/v1/conversations/:id", async (request) => {
      const c = await store().get(id(request));
      return { ...c, activeRun: [...runs.entries()].find(([, r]) => r.conversationId === c.id)?.[0] ?? null };
    });
    app.post("/api/v1/ask-runs/:id/cancel", async (request) => {
      const run = runs.get(id(request));
      if (run) run.controller.abort();
      return { ok: true, wasRunning: !!run };
    });

    app.post("/api/v1/conversations/:id/ask", async (request, reply) => {
      const { question } = rc.parse(AskRequest, request.body);
      const service = state.requireService();
      const conversationId = id(request);
      // Admission: check and take the slot with no await in between (one run per conversation).
      if (busy.has(conversationId)) throw busyError();
      busy.add(conversationId);
      try {
        return reply.code(202).send(await startRun(state, service, conversationId, question));
      } catch (e) {
        busy.delete(conversationId); // nothing was started: release the slot
        throw e;
      }
    });
  };
}

/**
 * Store the question and a running answer, then answer in the background. The caller holds
 * the conversation's slot in `busy`; once this returns, the background task owns it and
 * releases it only after the answer has been written.
 */
async function startRun(state: AppState, service: WorkspaceService, conversationId: string, question: string): Promise<{ runId: string; conversationId: string }> {
  const conversations = new ConversationStore(service);
  const availability = askAvailability(state);
  if (!availability.available) throw new NexusError("VALIDATION", availability.message, { reason: availability.reason });
  const ctx = aiContext(state);
  // Pin the profile and model for this run.
  const profile = structuredClone(ctx.registry.selected()!);
  const key = ctx.keys.reveal(profile.id)!;
  const runId = newId("run");
  const at = new Date().toISOString();
  const pending = { id: newId("msg"), role: "assistant" as const, at, runId, text: null, status: "running" as const, answer: null, meta: null, error: null };
  let history: PriorTurn[] = [];
  await conversations.update(conversationId, (c) => {
    history = priorTurns(c.messages); // the answered turns before this question
    c.messages.push({ id: newId("msg"), role: "user", at, runId, text: question, status: "complete", answer: null, meta: null, error: null });
    if (c.messages.filter((m) => m.role === "user").length === 1 && c.title === "New conversation") c.title = question.slice(0, 80);
    c.messages.push(pending);
    c.updatedAt = at;
  });
  const controller = new AbortController();
  runs.set(runId, { controller, conversationId, activity: "Starting" });
  const workspace = readOnlyWorkspace(service, searchIndexFor(state), requireEngine(state));
  state.publish({ type: "ask.progress", runId, conversationId, activity: "Starting" });

  void (async () => {
    let update: Partial<Conversation["messages"][number]>;
    try {
      const result = await runAsk({
        workspace, question, profile, key, receivingHost: receivingHost(profile.baseUrl), signal: controller.signal, history,
        onProgress: (p) => { state.publish({ type: "ask.progress", runId, conversationId, activity: p.activity }); },
      });
      update = {
        status: "complete", answer: result.answer,
        meta: { profileName: result.profileName, model: result.model, receivingHost: result.receivingHost, mode: result.mode, fixture: result.fixture, scopeNote: result.scopeNote, steps: result.steps, rejectedToolCalls: result.rejectedToolCalls, plainReplyIgnored: result.plainReplyIgnored, contextTurns: result.contextTurns },
      };
    } catch (e) {
      const err = e instanceof NexusError ? { code: e.code, message: e.message } : describeProviderError(e, ctx);
      update = { status: err.code === "CANCELLED" ? "cancelled" : "failed", error: err.code === "CANCELLED" ? { code: "CANCELLED", message: "You cancelled this question." } : err };
      state.log(`ask: run ${update.status} (${err.code})`);
    } finally {
      runs.delete(runId);
    }
    try {
      await conversations.update(conversationId, async (latest) => {
        const msg = latest.messages.find((m) => m.id === pending.id);
        if (msg) Object.assign(msg, update);
        latest.updatedAt = new Date().toISOString();
        await faultDelay("ask:before-answer-save");
      });
    } catch (e) {
      state.log(`ask: could not save the answer: ${(e as Error).message.slice(0, 120)}`);
    } finally {
      busy.delete(conversationId); // the answer is durable (or could not be saved): admit the next question
    }
    state.publish({ type: "ask.done", runId, conversationId });
  })();
  return { runId, conversationId };
}

/** Mark answers left "running" by a crash or restart as failed, so Retry is offered. */
export async function settleInterruptedRuns(service: WorkspaceService): Promise<void> {
  const store = new ConversationStore(service);
  for (const id of await service.listConversationIds()) {
    try {
      const c = await store.get(id);
      let changed = false;
      for (const m of c.messages) if (m.status === "running") { m.status = "failed"; m.error = { code: "INTERRUPTED", message: "Nexus stopped before this answer finished." }; changed = true; }
      if (changed) await store.save(c);
    } catch { /* skip */ }
  }
}
