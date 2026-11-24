// One OpenAI-compatible chat-completions adapter (PRD-074, PRD-075).
import { sanitiseDiagnostic } from "./sanitise.mjs";

export type ProviderErrorKind = "auth" | "rate_limit" | "timeout" | "cancelled" | "network" | "http" | "bad_response";

export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string, readonly status: number | null = null, readonly retryAfterMs: number | null = null) {
    super(message);
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface ChatRequest {
  baseUrl: string;
  model: string;
  key: string;
  messages: ChatMessage[];
  tools?: Array<{ type: "function"; function: { name: string; description: string; parameters: unknown } }>;
  toolChoice?: unknown;
  responseFormat?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  /** Called with a short status line for each retry (for progress display). */
  onRetry?: (why: string) => void;
}

export interface ChatResult {
  message: { content: string | null; tool_calls?: ChatMessage["tool_calls"] };
  fixture: boolean;
  model: string;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new ProviderError("cancelled", "Cancelled.")); }, { once: true });
});

/** The provider's own error text, sanitised at the source: it may echo the key. */
function providerMessage(body: unknown, key: string): string {
  const msg = (body as { error?: { message?: unknown } })?.error?.message;
  return typeof msg === "string" ? sanitiseDiagnostic(msg, { keys: [key], max: 300 }) : "";
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const maxRetries = req.maxRetries ?? 2;
  const timeoutMs = req.timeoutMs ?? 60_000;
  let lastError: ProviderError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (req.signal?.aborted) throw new ProviderError("cancelled", "Cancelled.");
    const controller = new AbortController();
    const onAbort = () => controller.abort("cancelled");
    req.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetch(`${req.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${req.key}` },
          body: JSON.stringify({
            model: req.model,
            messages: req.messages,
            ...(req.tools ? { tools: req.tools } : {}),
            ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
            ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
            temperature: 0,
          }),
          signal: controller.signal,
        });
      } catch {
        if (req.signal?.aborted) throw new ProviderError("cancelled", "Cancelled.");
        if (controller.signal.reason === "timeout") throw new ProviderError("timeout", `The provider did not answer within ${Math.round(timeoutMs / 1000)} s.`);
        throw new ProviderError("network", "Could not reach the provider. Check the address and your connection.");
      }
      const fixture = res.headers.get("x-nexus-fixture") === "1";
      const text = await res.text();
      let body: unknown = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      const said = providerMessage(body, req.key);
      if (res.status === 401 || res.status === 403) throw new ProviderError("auth", `The provider rejected the key${said ? `: ${said}` : "."}`, res.status);
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        throw new ProviderError("rate_limit", `The provider is rate limiting requests${said ? `: ${said}` : "."}`, 429, Number.isFinite(ra) ? ra * 1000 : null);
      }
      if (res.status >= 500) throw new ProviderError("http", `The provider had an error (${res.status}).`, res.status);
      if (!res.ok) throw new ProviderError("http", `The provider refused the request (${res.status})${said ? `: ${said}` : "."}`, res.status);
      const message = (body as { choices?: Array<{ message?: ChatResult["message"] }> })?.choices?.[0]?.message;
      if (!message) throw new ProviderError("bad_response", "The provider returned a response Nexus could not read.");
      return { message, fixture, model: String((body as { model?: unknown })?.model ?? req.model) };
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError("network", "Could not reach the provider.");
      const retriable = err.kind === "rate_limit" || err.kind === "timeout" || (err.kind === "http" && (err.status ?? 0) >= 500) || err.kind === "network";
      if (!retriable || attempt === maxRetries) throw err;
      lastError = err;
      const wait = err.retryAfterMs !== null ? Math.min(err.retryAfterMs, 10_000) : 500 * 2 ** attempt;
      req.onRetry?.(`${err.kind === "rate_limit" ? "Rate limited" : "Provider problem"}; retrying in ${Math.round(wait / 100) / 10} s`);
      await sleep(wait, req.signal);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastError ?? new ProviderError("network", "Could not reach the provider.");
}
