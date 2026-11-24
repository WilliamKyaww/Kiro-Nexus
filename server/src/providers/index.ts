// Provider settings API and key delivery (PRD-074 to PRD-076).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RouteContext } from "../app";
import { NexusError } from "../errors";
import type { AppState } from "../state";
import { KeyStore, type KeyStorage } from "./keys";
import { ProviderError } from "./openai";
import { NewProfileRequest, PROVIDER_TEMPLATES, ProviderRegistry, receivingHost, type ProviderProfile } from "./profiles";
import { probeProfile } from "./probe";

export interface AiContext { registry: ProviderRegistry; keys: KeyStore; desktop: boolean }
const contexts = new WeakMap<AppState, AiContext>();

export async function installProviders(state: AppState): Promise<AiContext> {
  const ctx: AiContext = { registry: await ProviderRegistry.load(state.profileDir), keys: new KeyStore(), desktop: process.env.NEXUS_DESKTOP === "1" };
  contexts.set(state, ctx);
  state.addLogRedactor((line) => ctx.keys.redact(line));
  return ctx;
}

export function aiContext(state: AppState): AiContext {
  const ctx = contexts.get(state);
  if (!ctx) throw new NexusError("INTERNAL", "Providers are not initialised.");
  return ctx;
}

/** Messages from Electron main over the private utilityProcess port. */
export function handleParentMessage(state: AppState, data: unknown): void {
  const ctx = contexts.get(state);
  const m = data as { type?: string; profileId?: string; key?: string; storage?: KeyStorage };
  if (!ctx || typeof m?.profileId !== "string") return;
  if (m.type === "provider-key" && typeof m.key === "string") {
    try { ctx.keys.set(m.profileId, m.key, m.storage === "os-protected" ? "os-protected" : "session"); } catch { state.log("providers: ignored an invalid key from the desktop app"); }
  }
  if (m.type === "provider-key-delete") ctx.keys.delete(m.profileId);
}

export function profileView(ctx: AiContext, p: ProviderProfile) {
  // detail holds provider diagnostics; sanitise again on the way out (older files, new keys).
  const capabilities = { ...p.capabilities, detail: ctx.keys.sanitise(p.capabilities.detail) };
  return { ...p, capabilities, hasKey: ctx.keys.has(p.id), keyStorage: ctx.keys.storage(p.id), receivingHost: receivingHost(p.baseUrl) };
}

export function describeProviderError(e: unknown, ctx: AiContext): { code: string; message: string } {
  if (e instanceof ProviderError) {
    const message = ctx.keys.sanitise(e.message, 400) ?? "The provider returned an error.";
    const code = { auth: "PROVIDER_AUTH", rate_limit: "PROVIDER_RATE_LIMITED", timeout: "PROVIDER_TIMEOUT", cancelled: "CANCELLED", network: "PROVIDER_UNREACHABLE", http: "PROVIDER_ERROR", bad_response: "PROVIDER_BAD_RESPONSE" }[e.kind];
    return { code, message };
  }
  return { code: "INTERNAL", message: "Something went wrong while talking to the provider." };
}

const SessionKeyRequest = z.strictObject({ key: z.string().min(1).max(500) });

export function providerRoutes(state: AppState) {
  return (app: FastifyInstance, rc: RouteContext) => {
    const id = (r: { params: unknown }) => (r.params as { id: string }).id;
    app.get("/api/v1/providers", async () => {
      const ctx = aiContext(state);
      const data = ctx.registry.list();
      return {
        selectedId: data.selectedId,
        profiles: data.profiles.map((p) => profileView(ctx, p)),
        templates: PROVIDER_TEMPLATES,
        desktopKeys: ctx.desktop,
      };
    });
    app.post("/api/v1/providers", async (request, reply) => {
      const ctx = aiContext(state);
      const p = await ctx.registry.add(rc.parse(NewProfileRequest, request.body));
      return reply.code(201).send(profileView(ctx, p));
    });
    app.delete("/api/v1/providers/:id", async (request) => {
      const ctx = aiContext(state);
      await ctx.registry.remove(id(request));
      ctx.keys.delete(id(request));
      return { ok: true };
    });
    app.post("/api/v1/providers/:id/select", async (request) => {
      const ctx = aiContext(state);
      await ctx.registry.select(id(request));
      return profileView(ctx, ctx.registry.get(id(request)));
    });
    // Browser route: the key lives in service memory for this session only.
    app.put("/api/v1/providers/:id/session-key", async (request) => {
      const ctx = aiContext(state);
      ctx.registry.get(id(request));
      const { key } = rc.parse(SessionKeyRequest, request.body);
      try { ctx.keys.set(id(request), key, "session"); } catch (e) { throw new NexusError("VALIDATION", (e as Error).message); }
      return profileView(ctx, ctx.registry.get(id(request)));
    });
    app.delete("/api/v1/providers/:id/session-key", async (request) => {
      aiContext(state).keys.delete(id(request));
      return { ok: true };
    });
    app.post("/api/v1/providers/:id/test", async (request) => {
      const ctx = aiContext(state);
      const p = ctx.registry.get(id(request));
      const key = ctx.keys.reveal(p.id);
      if (!key) throw new NexusError("VALIDATION", "Add a key for this profile first.");
      try {
        const caps = await probeProfile(p, key);
        // Sanitised before it is saved: non-fatal probe errors carry the provider's own text.
        const safe = { ...caps, detail: ctx.keys.sanitise(caps.detail) };
        return { profile: profileView(ctx, await ctx.registry.setCapabilities(p.id, safe)) };
      } catch (e) {
        const err = describeProviderError(e, ctx);
        await ctx.registry.setCapabilities(p.id, { ...p.capabilities, testedAt: new Date().toISOString(), detail: err.message, toolCalling: "error", structuredOutput: "error" });
        throw new NexusError("VALIDATION", err.message, { providerCode: err.code });
      }
    });
  };
}
