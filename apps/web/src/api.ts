// Session bootstrap, authenticated fetch and the live event stream (DEC-011).
const TOKEN_KEY = "nexus.session";

export type SessionState = { status: "ready"; token: string } | { status: "needs-launch"; reason: "fresh" | "expired" | "ended" };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

let token: string | null = null;
const sessionListeners = new Set<(s: SessionState) => void>();

export function onSessionChange(fn: (s: SessionState) => void): () => void {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

function endSession(reason: "expired" | "ended"): void {
  token = null;
  sessionStorage.removeItem(TOKEN_KEY);
  for (const fn of sessionListeners) fn({ status: "needs-launch", reason });
}

/** Runs before React renders. Moves a launch code out of the URL fragment and exchanges it. */
export async function bootstrapSession(): Promise<SessionState> {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const code = fragment.get("launch");
  if (code) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const res = await fetch("/api/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchCode: code }),
    }).catch(() => null);
    if (res?.ok) {
      token = ((await res.json()) as { token: string }).token;
      sessionStorage.setItem(TOKEN_KEY, token);
      return { status: "ready", token };
    }
    sessionStorage.removeItem(TOKEN_KEY);
    return { status: "needs-launch", reason: "expired" };
  }
  const stored = sessionStorage.getItem(TOKEN_KEY);
  if (stored) {
    token = stored;
    return { status: "ready", token };
  }
  return { status: "needs-launch", reason: "fresh" };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!token) throw new ApiError(401, "UNAUTHENTICATED", "No session.");
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) endSession("ended");
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "INTERNAL", err.message ?? `Request failed (${res.status})`, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => call<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
  del: <T>(path: string) => call<T>("DELETE", path),
};

export interface ServerEvent { type: string; path?: string; [key: string]: unknown }

/** Server-sent events read through fetch so the bearer header is kept. Reconnects with backoff. */
export function subscribeEvents(onEvent: (e: ServerEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let delay = 500;
  const run = async () => {
    while (!stopped && token) {
      controller = new AbortController();
      try {
        const res = await fetch("/api/v1/events", { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
        if (res.status === 401) { endSession("ended"); return; }
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        onStatus?.(true);
        delay = 500;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (data) {
              try { onEvent(JSON.parse(data) as ServerEvent); } catch { /* ignore malformed */ }
            }
          }
        }
      } catch {
        if (stopped) return;
      }
      onStatus?.(false);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
    }
  };
  void run();
  return () => { stopped = true; controller?.abort(); };
}

export const notePathParam = (path: string, heading?: string | null) =>
  `/notes?path=${encodeURIComponent(path)}${heading ? `&heading=${encodeURIComponent(heading)}` : ""}`;
