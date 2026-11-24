// Deterministic OpenAI-compatible TEST DOUBLE for Nexus tests. It is NOT AI.
// It answers only from the tool results / data it is given, using a fixed
// checklist-to-issue matching rule, and labels every response as a fixture
// (header x-nexus-fixture: 1). Behaviour is selected by the model name:
//   nexus-test-double             tool calling + structured output
//   nexus-test-double-structured  structured output only (no tools)
//   nexus-test-double-invent      adds an invented citation S99
//   nexus-test-double-writer      first tries to call propose_changes
//   nexus-test-double-plain       replies with plain text, no tool call
//   nexus-test-double-401 / -429 / -slow   failure modes
// Usage: node tools/provider-double/server.mjs [port]
import { createServer } from "node:http";

const STOP = new Set("a an and are as at be by did do does for from has have how i in is it its of on or still that the their them there this to was we were what which who will with without no not any issue issues tracked yet".split(" "));
const stem = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ing|ed|es|s)$/, "");
const words = (s) => (s.match(/[A-Za-z0-9']+/g) ?? []).map(stem).filter((w) => w.length > 2 && !STOP.has(w));

function contentText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) return message.content.map((p) => p.text ?? "").join("");
  return "";
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** Pull the data object out of a Nexus tool result ({ data, notice }) or raw JSON. */
function toolData(text) {
  const parsed = parseJson(text);
  return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}

/** The fixed rule: checklist items in the consulted section, matched to issues by title words. */
export function buildAnswer({ section, issues, invent = false }) {
  if (!section || typeof section.text !== "string") {
    return { facts: [], discrepancies: [], suggestions: [], insufficientEvidence: true, insufficientReason: "No relevant note section was found." };
  }
  const items = [...section.text.matchAll(/^\s*[-*] \[( |x|X)\] (.+)$/gm)].map((m) => ({ done: m[1].toLowerCase() === "x", text: m[2].trim() }));
  if (items.length === 0) {
    return { facts: [], discrepancies: [], suggestions: [], insufficientEvidence: true, insufficientReason: "The consulted section has no checklist of actions." };
  }
  const facts = [];
  const discrepancies = [];
  const suggestions = [];
  for (const item of items) {
    const itemWords = new Set(words(item.text));
    let best = null;
    let bestScore = 0;
    for (const issue of issues ?? []) {
      const titleWords = words(issue.title);
      const shared = titleWords.filter((w) => itemWords.has(w)).length;
      const score = titleWords.length ? shared / titleWords.length : 0;
      if (shared >= 2 && score > bestScore) { best = issue; bestScore = score; }
    }
    if (best) {
      facts.push({ text: `“${item.text}” is tracked by ${best.key} (${best.title}, status ${best.status}).`, sources: [section.handle, best.handle] });
      if (item.done !== (best.status === "done")) {
        discrepancies.push({ text: `The note marks “${item.text}” as ${item.done ? "done" : "not done"}, but ${best.key} is ${best.status}.`, sources: [section.handle, best.handle] });
      }
    } else {
      facts.push({ text: `“${item.text}” has no matching issue.`, sources: [section.handle] });
      suggestions.push({ text: `Create an issue for “${item.text}”.`, sources: [section.handle] });
    }
  }
  if (invent) facts.push({ text: "An invented claim with a made-up citation.", sources: ["S99"] });
  return { facts, discrepancies, suggestions, insufficientEvidence: false };
}

function toolCall(name, args, n) {
  return { id: `call_${n}_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function chooseSection(results, question) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const q = new Set(words(question).concat(question.toLowerCase().includes("action") ? ["action"] : []));
  const scored = results.map((r) => {
    const heading = (r.headingPath ?? []).join(" ").toLowerCase();
    let s = 0;
    if (/action/.test(heading) && /action/i.test(question)) s += 5;
    for (const w of words(heading)) if (q.has(w)) s += 1;
    return { r, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0].r;
}

/** Tool-mode agent: search → read best section → query issues → final_answer. */
function agentStep(body, variant) {
  const messages = body.messages ?? [];
  const question = contentText([...messages].reverse().find((m) => m.role === "user"));
  const calls = messages.filter((m) => m.role === "assistant").flatMap((m) => m.tool_calls ?? []);
  const results = new Map();
  for (const m of messages) if (m.role === "tool") results.set(m.tool_call_id, toolData(contentText(m)));
  const resultOf = (name) => {
    const call = [...calls].reverse().find((c) => c.function?.name === name);
    return call ? results.get(call.id) : undefined;
  };
  const n = calls.length + 1;
  if (variant === "writer" && !calls.some((c) => c.function?.name === "propose_changes")) {
    return { tool_calls: [toolCall("propose_changes", { operations: [] }, n)] };
  }
  const search = resultOf("search_notes");
  if (search === undefined) {
    const query = words(question).slice(0, 6).join(" ") || question.slice(0, 60);
    return { tool_calls: [toolCall("search_notes", { query, limit: 6 }, n)] };
  }
  const picked = chooseSection(search?.results, question);
  const section = resultOf("read_note_section");
  if (picked && section === undefined) {
    return { tool_calls: [toolCall("read_note_section", { path: picked.path, headingSlug: picked.headingSlug ?? undefined }, n)] };
  }
  const issues = resultOf("query_issues");
  if (issues === undefined) return { tool_calls: [toolCall("query_issues", {}, n)] };
  const answer = buildAnswer({ section: section && !section.error ? section : null, issues: issues?.issues, invent: variant === "invent" });
  return { tool_calls: [toolCall("final_answer", answer, n)] };
}

/** Retrieval-first: the data arrives in one user message as JSON after a marker. */
function structuredAnswer(body, variant) {
  const text = (body.messages ?? []).map(contentText).join("\n");
  const marker = text.indexOf("RETRIEVED_DATA_JSON:");
  const data = marker >= 0 ? parseJson(text.slice(marker + "RETRIEVED_DATA_JSON:".length).trim().split("\nEND_RETRIEVED_DATA")[0]) : null;
  const question = data?.question ?? "";
  const sections = data?.sections ?? [];
  const best = chooseSection(sections, question);
  return buildAnswer({ section: best, issues: data?.issues ?? [], invent: variant === "invent" });
}

export function handleChat(body) {
  const model = String(body.model ?? "");
  const variant = model.replace(/^nexus-test-double-?/, "") || "tools";
  const wantsTools = Array.isArray(body.tools) && body.tools.length > 0;
  const schemaName = body.response_format?.json_schema?.name;
  if (variant === "structured" && wantsTools) return { status: 400, body: { error: { message: "This model does not support tools.", type: "invalid_request_error" } } };
  const reply = (message) => ({ status: 200, body: { id: "chatcmpl-fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: null, ...message }, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] } });
  // Capability probes.
  if (wantsTools && body.tools.some((t) => t.function?.name === "ping")) return reply({ tool_calls: [toolCall("ping", { value: "nexus" }, 1)] });
  if (schemaName === "probe") return reply({ content: JSON.stringify({ ok: true }) });
  if (variant === "plain") return reply({ content: "Here is a friendly answer without any structure." });
  if (schemaName === "final_answer") return reply({ content: JSON.stringify(structuredAnswer(body, variant)) });
  if (wantsTools) return reply(agentStep(body, variant));
  return reply({ content: "Fixture reply." });
}

export function startProviderDouble(port = 0) {
  const requests = [];
  const server = createServer((req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", "x-nexus-fixture": "1", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) return send(404, { error: { message: "Not found" } });
    const auth = req.headers.authorization ?? "";
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      const body = parseJson(raw) ?? {};
      requests.push({ model: body.model, auth, body });
      const model = String(body.model ?? "");
      if (!auth.startsWith("Bearer ") || auth === "Bearer invalid-key" || model.endsWith("-401")) return send(401, { error: { message: "Invalid API key provided.", type: "invalid_request_error" } });
      if (model.endsWith("-429")) return send(429, { error: { message: "Rate limit reached for requests.", type: "rate_limit" } }, { "retry-after": "0" });
      const respond = () => { const r = handleChat(body); send(r.status, r.body); };
      const isProbe = (Array.isArray(body.tools) && body.tools.some((t) => t.function?.name === "ping")) || body.response_format?.json_schema?.name === "probe";
      if (model.endsWith("-slow") && !isProbe) setTimeout(respond, 20_000); else respond();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requests,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) {
  const d = await startProviderDouble(Number(process.argv[2] ?? 0));
  console.log(JSON.stringify({ event: "ready", baseUrl: d.baseUrl, note: "Test double: deterministic fixture, not AI." }));
}
