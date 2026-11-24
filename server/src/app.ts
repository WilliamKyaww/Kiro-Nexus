// HTTP surface (architecture 4.1, DEC-011).
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import type { ServerResponse } from "node:http";
import type { z } from "zod";
import {
  CreateIssueRequest, CreateNoteRequest, CreateProjectRequest, OpenWorkspaceRequest, SampleWorkspaceRequest,
  SaveNoteRequest, SessionRequest, UpdateIssueRequest, type WorkspaceView,
} from "@nexus/schema";
import { NexusError } from "./errors";
import { SessionManager, bearer } from "./security/session";
import type { AppState } from "./state";
import { copySampleWorkspace } from "./workspace/service";

export interface AppOptions {
  state: AppState;
  sessions: SessionManager;
  webDist: string | null;
  sampleDir: string | null;
  onShutdownRequest?: () => void;
  /** Extra route modules (review, search) registered after the core routes. */
  plugins?: Array<(app: FastifyInstance, ctx: RouteContext) => void>;
}

export interface RouteContext {
  state: AppState;
  parse: <T>(schema: z.ZodType<T>, value: unknown) => T;
}

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
].join("; ");

/** Routes that need no session token. Everything else under /api/ does. */
const controlRoutes = new Set(["POST /api/v1/launch-codes", "POST /api/v1/shutdown"]);
const openRoutes = new Set(["POST /api/v1/session"]);

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new NexusError("VALIDATION", "The request was not valid.", result.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

export function createApp(options: AppOptions): FastifyInstance {
  const { state, sessions } = options;
  // logger: false disables Fastify's own request logging; our onResponse hook logs route patterns only.
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024, forceCloseConnections: true, trustProxy: false });
  const streams = new Set<ServerResponse>();
  const started = new WeakMap<FastifyRequest, number>();

  // 1. Host check (DNS rebinding) and timing.
  app.addHook("onRequest", async (request, reply) => {
    started.set(request, performance.now());
    const port = state.port;
    const host = request.headers.host ?? "";
    if (port === null || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      return reply.code(403).send({ error: { code: "FORBIDDEN_HOST", message: "Requests must address the loopback service directly." } });
    }
    // 2. Authentication for the API surface.
    if (!request.url.startsWith("/api/")) return;
    const routeKey = `${request.method} ${request.routeOptions.url ?? ""}`;
    if (openRoutes.has(routeKey)) return;
    const presented = bearer(request.headers.authorization);
    if (controlRoutes.has(routeKey)) {
      if (!sessions.isControlSecret(presented)) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Control secret required." } });
      return;
    }
    if (!sessions.isValidToken(presented)) {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Open Nexus from its launcher to start a session." } });
    }
  });

  // Request log: method, route pattern, status, duration. Never URLs, headers or bodies.
  app.addHook("onResponse", async (request, reply) => {
    const ms = performance.now() - (started.get(request) ?? performance.now());
    state.log(`http: ${request.method} ${request.routeOptions.url ?? "(unmatched)"} ${reply.statusCode} ${ms.toFixed(0)}ms`);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("content-security-policy", CSP);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("cross-origin-resource-policy", "same-origin");
    if (request.url.startsWith("/api/") || request.url === "/" || !request.url.includes(".")) reply.header("cache-control", "no-store");
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof NexusError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "VALIDATION", message: "The request could not be read." } });
    }
    state.log(`error: ${(error as Error).name}: ${(error as Error).message}`);
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Something went wrong in the Nexus service." } });
  });

  const ctx: RouteContext = { state, parse: parseBody };

  // ---------- Session ----------
  app.post("/api/v1/launch-codes", async () => ({ launchCode: sessions.mintLaunchCode() }));
  app.post("/api/v1/session", async (request, reply) => {
    const { launchCode } = parseBody(SessionRequest, request.body);
    const token = sessions.exchange(launchCode);
    if (!token) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "This launch link has expired or was already used. Open Nexus again from its launcher." } });
    return { token };
  });
  app.post("/api/v1/shutdown", async () => {
    setImmediate(() => options.onShutdownRequest?.());
    return { ok: true };
  });

  // ---------- Workspace ----------
  app.get("/api/v1/workspace", async (): Promise<WorkspaceView> => {
    const s = state.service;
    return {
      workspace: s ? { root: s.root, name: s.manifest.name, workspaceId: s.manifest.workspaceId, timeZone: s.manifest.timeZone } : null,
      recent: await state.recent(),
      openError: state.openError,
    };
  });
  app.post("/api/v1/workspace/open", async (request) => {
    const { path } = parseBody(OpenWorkspaceRequest, request.body);
    if (!isAbsolute(path)) throw new NexusError("BAD_PATH", "Enter the full folder path, for example C:\\Users\\you\\Documents\\Nexus.");
    await state.open(path);
    return { ok: true };
  });
  app.post("/api/v1/workspace/sample", async (request) => {
    const { targetPath } = parseBody(SampleWorkspaceRequest, request.body);
    if (!isAbsolute(targetPath)) throw new NexusError("BAD_PATH", "Enter the full path of a new, empty folder.");
    if (!options.sampleDir || !existsSync(options.sampleDir)) throw new NexusError("NOT_FOUND", "The sample workspace is not available in this build.");
    const target = await copySampleWorkspace(options.sampleDir, targetPath);
    await state.open(target);
    return { ok: true, path: target };
  });

  // ---------- Notes ----------
  app.get("/api/v1/notes", async () => ({ notes: await state.requireService().listNotes() }));
  app.get("/api/v1/notes/content", async (request) => {
    const path = (request.query as { path?: string }).path;
    if (!path) throw new NexusError("VALIDATION", "path is required");
    return state.requireService().readNote(path);
  });
  app.post("/api/v1/notes", async (request, reply) => {
    const body = parseBody(CreateNoteRequest, request.body);
    const note = await state.requireService().createNote(body.path, body.content);
    return reply.code(201).send(note);
  });
  app.put("/api/v1/notes/content", async (request) => {
    const body = parseBody(SaveNoteRequest, request.body);
    return state.requireService().saveNote(body.path, body.content, body.baseRevision);
  });

  // ---------- Projects and issues ----------
  app.get("/api/v1/projects", async () => ({ projects: state.requireService().listProjects() }));
  app.post("/api/v1/projects", async (request, reply) => {
    const body = parseBody(CreateProjectRequest, request.body);
    return reply.code(201).send(await state.requireService().createProject(body.key, body.name));
  });
  app.get("/api/v1/issues", async (request) => {
    const projectId = (request.query as { projectId?: string }).projectId;
    return { issues: state.requireService().listIssues(projectId) };
  });
  app.post("/api/v1/issues", async (request, reply) => {
    const body = parseBody(CreateIssueRequest, request.body);
    return reply.code(201).send(await state.requireService().createIssue(body));
  });
  app.get("/api/v1/issues/:key", async (request) => state.requireService().getIssue((request.params as { key: string }).key));
  app.patch("/api/v1/issues/:key", async (request) => {
    const body = parseBody(UpdateIssueRequest, request.body);
    return state.requireService().updateIssue((request.params as { key: string }).key, body.baseRevision, body.patch, body.baseValues);
  });

  // ---------- Live events (authenticated fetch stream) ----------
  app.get("/api/v1/events", (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.write(": connected\n\n");
    streams.add(res);
    const send = (event: { type: string }) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    state.bus.on("event", send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      state.bus.off("event", send);
      streams.delete(res);
    };
    request.raw.on("close", cleanup);
    res.on("close", cleanup);
  });
  app.addHook("onClose", async () => {
    for (const res of streams) res.end();
  });

  for (const plugin of options.plugins ?? []) plugin(app, ctx);

  // ---------- Static app shell (no workspace data, no auth) ----------
  const indexFile = options.webDist ? join(options.webDist, "index.html") : null;
  if (options.webDist && indexFile && existsSync(indexFile)) {
    app.register(fastifyStatic, { root: options.webDist, prefix: "/", index: false, wildcard: false, decorateReply: true });
  }
  app.setNotFoundHandler((request, reply: FastifyReply) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found." } });
    }
    if (!indexFile || !existsSync(indexFile)) return reply.code(503).type("text/plain").send("The Nexus UI has not been built. Run: npm run build");
    return reply.type("text/html; charset=utf-8").sendFile("index.html");
  });

  return app;
}
