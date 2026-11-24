// Probe tool calling and structured output separately (PRD-075).
import type { ProviderProfile } from "./profiles";
import { ProviderError, chat } from "./openai";

type Cap = ProviderProfile["capabilities"];

export async function probeProfile(profile: ProviderProfile, key: string, signal?: AbortSignal): Promise<Cap> {
  const base = { baseUrl: profile.baseUrl, model: profile.model, key, signal, timeoutMs: 30_000, maxRetries: 1 };
  const notes: string[] = [];
  let fixture = false;
  const classify = (e: unknown): "no" | "error" => {
    if (e instanceof ProviderError && e.kind === "http" && e.status !== null && e.status >= 400 && e.status < 500) return "no";
    return "error";
  };

  let toolCalling: Cap["toolCalling"] = "unknown";
  try {
    const r = await chat({
      ...base,
      messages: [{ role: "user", content: "Call the ping tool with the value \"nexus\"." }],
      tools: [{ type: "function", function: { name: "ping", description: "Connectivity check.", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } } }],
      toolChoice: { type: "function", function: { name: "ping" } },
    });
    fixture ||= r.fixture;
    const call = r.message.tool_calls?.[0];
    let args: unknown = null;
    try { args = JSON.parse(call?.function.arguments ?? ""); } catch { args = null; }
    toolCalling = call?.function.name === "ping" && args && typeof args === "object" ? "yes" : "no";
    if (toolCalling === "no") notes.push("Tool calling: the model did not call the tool.");
  } catch (e) {
    if (e instanceof ProviderError && (e.kind === "auth" || e.kind === "cancelled")) throw e;
    toolCalling = classify(e);
    notes.push(`Tool calling: ${(e as Error).message}`);
  }

  let structuredOutput: Cap["structuredOutput"] = "unknown";
  try {
    const r = await chat({
      ...base,
      messages: [{ role: "user", content: "Reply with a JSON object whose ok property is true." }],
      responseFormat: { type: "json_schema", json_schema: { name: "probe", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } },
    });
    fixture ||= r.fixture;
    let parsed: unknown = null;
    try { parsed = JSON.parse(r.message.content ?? ""); } catch { parsed = null; }
    structuredOutput = parsed && typeof (parsed as { ok?: unknown }).ok === "boolean" ? "yes" : "no";
    if (structuredOutput === "no") notes.push("Structured output: the reply did not match the schema.");
  } catch (e) {
    if (e instanceof ProviderError && (e.kind === "auth" || e.kind === "cancelled")) throw e;
    structuredOutput = classify(e);
    notes.push(`Structured output: ${(e as Error).message}`);
  }

  return { toolCalling, structuredOutput, testedAt: new Date().toISOString(), detail: notes.join(" ").slice(0, 400) || null, fixture };
}
