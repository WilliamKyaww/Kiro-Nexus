// Ask API: availability, conversations, runs and cancellation (slice C).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteContext } from "../app";
import { NexusError } from "../errors";
import { searchIndexFor } from "../notes";
import { aiContext, describeProviderError } from "../providers";
import { receivingHost } from "../providers/profiles";
import { requireEngine } from "../review";
import type { AppState } from "../state";
import { newId } from "../workspace/service";
import { runAsk } from "./coordinator";
import { ConversationStore, type Conversation } from "./conversations";
import { readOnlyWorkspace } from "./workspace";

const AskRequest = z.strictObject({ question: z.string().trim().min(3).max(2000) });
const NewConversation = z.strictObject({ title: z.string().trim().max(120).optional() });

interface ActiveRun { controller: AbortController; conversationId: string; activity: string }
const runs = new Map<string, ActiveRun>();

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
      const conversations = new ConversationStore(service);
      const conversation = await conversations.get(id(request));
      if ([...runs.values()].some((r) => r.conversationId === conversation.id)) throw new NexusError("CONFLICT", "This conversation is already answering a question.");
      const availability = askAvailability(state);
      if (!availability.available) throw new NexusError("VALIDATION", availability.message, { reason: availability.reason });
      const ctx = aiContext(state);
      // Pin the profile and model for this run.
      const profile = structuredClone(ctx.registry.selected()!);
      const key = ctx.keys.reveal(profile.id)!;
      const runId = newId("run");
      const at = new Date().toISOString();
      conversation.messages.push({ id: newId("msg"), role: "user", at, runId, text: question, status: "complete", answer: null, meta: null, error: null });
      if (conversation.messages.filter((m) => m.role === "user").length === 1 && conversation.title === "New conversation") conversation.title = question.slice(0, 80);
      const pending = { id: newId("msg"), role: "assistant" as const, at, runId, text: null, status: "running" as const, answer: null, meta: null, error: null };
      conversation.messages.push(pending);
      conversation.updatedAt = at;
      await conversations.save(conversation);
      const controller = new AbortController();
      runs.set(runId, { controller, conversationId: conversation.id, activity: "Starting" });
      const workspace = readOnlyWorkspace(service, searchIndexFor(state), requireEngine(state));
      state.publish({ type: "ask.progress", runId, conversationId: conversation.id, activity: "Starting" });

      void (async () => {
        let update: Partial<Conversation["messages"][number]>;
        try {
          const result = await runAsk({
            workspace, question, profile, key, receivingHost: receivingHost(profile.baseUrl), signal: controller.signal,
            onProgress: (p) => { state.publish({ type: "ask.progress", runId, conversationId: conversation.id, activity: p.activity }); },
          });
          update = {
            status: "complete", answer: result.answer,
            meta: { profileName: result.profileName, model: result.model, receivingHost: result.receivingHost, mode: result.mode, fixture: result.fixture, scopeNote: result.scopeNote, steps: result.steps, rejectedToolCalls: result.rejectedToolCalls, plainReplyIgnored: result.plainReplyIgnored },
          };
        } catch (e) {
          const err = e instanceof NexusError ? { code: e.code, message: e.message } : describeProviderError(e, ctx);
          update = { status: err.code === "CANCELLED" ? "cancelled" : "failed", error: err.code === "CANCELLED" ? { code: "CANCELLED", message: "You cancelled this question." } : err };
          state.log(`ask: run ${update.status} (${err.code})`);
        } finally {
          runs.delete(runId);
        }
        try {
          const latest = await conversations.get(conversation.id);
          const msg = latest.messages.find((m) => m.id === pending.id);
          if (msg) Object.assign(msg, update);
          latest.updatedAt = new Date().toISOString();
          await conversations.save(latest);
        } catch (e) {
          state.log(`ask: could not save the answer: ${(e as Error).message.slice(0, 120)}`);
        }
        state.publish({ type: "ask.done", runId, conversationId: conversation.id });
      })();
      return reply.code(202).send({ runId, conversationId: conversation.id });
    });
  };
}

/** Mark answers left "running" by a crash or restart as failed, so Retry is offered. */
export async function settleInterruptedRuns(service: import("../workspace/service").WorkspaceService): Promise<void> {
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
