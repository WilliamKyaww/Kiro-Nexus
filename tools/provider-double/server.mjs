// Deterministic OpenAI-compatible TEST DOUBLE for Nexus tests. It is NOT AI.
// It answers only from the tool results / data it is given, using a fixed
// checklist-to-issue matching rule, and labels every response as a fixture
// (header x-nexus-fixture: 1). Behaviour is selected by the model name:
//   nexus-test-double             tool calling + structured output
//   nexus-test-double-structured  structured output only (no tools)
//   nexus-test-double-invent      adds an invented citation S99
//   nexus-test-double-writer      first tries to call propose_changes
//   nexus-test-double-plain       replies with plain text, no tool call
//   nexus-test-double-none        supports neither tools nor structured output (400)
//   nexus-test-double-unsure      always answers "insufficient evidence"
//   nexus-test-double-nocite      cites the note but never the issue records
//   nexus-test-double-echo        echoes the key in error messages (tool probe and questions)
//   nexus-test-double-lazy        reads only the first page of issues, then answers
//   nexus-test-double-narrow      looks each action up by its words (owner's name included)
//   nexus-test-double-heading     claims an issue tracks every action under the heading it links to
//   nexus-test-double-noissues    never reads issues; answers "do not appear on the board" as a fact
// Every variant uses records Nexus supplies when it answers "not accepted yet" to final_answer.
//   nexus-test-double-401 / -429 / -slow   failure modes
// Usage: node tools/provider-double/server.mjs [port]
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// Same wording as the product's status labels (apps/web/src/format.ts).
const STATUS_TEXT = { todo: "to do", in_progress: "in progress", done: "done" };
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
/** Earlier questions from the conversation-context block Nexus sends with a follow-up. */
function earlierQuestions(text) {
  return [...String(text ?? "").matchAll(/^Question \d+: (.+)$/gm)].map((m) => m[1].trim());
}

/**
 * The fixed reading of a question. A follow-up that refers back ("those", "them") borrows
 * its topic from the latest earlier question; "already tracked" asks for tracked items only.
 */
function readQuestion(question, contextText) {
  const refersBack = (q) => /\b(those|these|them|they|that one|it)\b/i.test(q);
  // Follow a chain of follow-ups back to the latest question that names its own topic.
  const anchor = [...earlierQuestions(contextText)].reverse().find((q) => !refersBack(q));
  const topic = refersBack(question) && anchor ? `${anchor} ${question}` : question;
  const only = /\b(already|is|are) tracked\b/i.test(question) && !/\bno issue\b/i.test(question) ? "tracked" : null;
  return { topic, only };
}

/**
 * The fixed rule: checklist items in the consulted section, matched to issues by title words,
 * reported as structured tracking entries (Nexus composes the visible sentences).
 * `headingLinks` imitates a model that treats a link to the section's heading as tracking
 * every action under it.
 */
export function buildAnswer({ section, issues, invent = false, citeIssues = true, only = null, headingLinks = false }) {
  const none = { facts: [], discrepancies: [], suggestions: [], tracking: [], insufficientEvidence: true };
  if (!section || typeof section.text !== "string") return { ...none, insufficientReason: "No relevant note section was found." };
  const items = [...section.text.matchAll(/^\s*[-*] \[( |x|X)\] (.+)$/gm)].map((m) => ({ done: m[1].toLowerCase() === "x", text: m[2].trim() }));
  if (items.length === 0) return { ...none, insufficientReason: "The consulted section has no checklist of actions." };
  const facts = [];
  const discrepancies = [];
  const suggestions = [];
  const tracking = [];
  for (const item of items) {
    if (headingLinks) {
      const linked = (issues ?? []).filter((i) => (i.linkedNotes ?? []).some((l) => l.heading && l.heading === section.headingText));
      if (linked.length) {
        tracking.push({ action: item.text, source: section.handle, status: "tracked", issues: linked.map((i) => i.handle), reason: `${linked.map((i) => i.key).join(", ")} links to this heading.` });
        continue;
      }
    }
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
      const status = STATUS_TEXT[best.status] ?? best.status;
      tracking.push({ action: item.text, source: section.handle, status: "tracked", issues: citeIssues ? [best.handle] : [], reason: `${best.key} (${best.title}) shares the action's words.` });
      if (item.done !== (best.status === "done")) {
        const sources = citeIssues ? [section.handle, best.handle] : [section.handle];
        discrepancies.push({ text: `The note marks “${item.text}” as ${item.done ? "done" : "not done"}, but ${best.key} is ${status}.`, sources });
      }
    } else if (only !== "tracked") {
      tracking.push({ action: item.text, source: section.handle, status: "untracked", issues: [], reason: "No issue title shares the action's words." });
      suggestions.push({ text: `Create an issue for “${item.text}”.`, sources: [section.handle] });
    }
  }
  if (only === "tracked" && tracking.length === 0) facts.push({ text: "None of these actions has a matching issue yet.", sources: [section.handle] });
  if (invent) facts.push({ text: "An invented claim with a made-up citation.", sources: ["S99"] });
  return { facts, discrepancies, suggestions, tracking, insufficientEvidence: false, insufficientReason: null };
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
  const asked = contentText([...messages].reverse().find((m) => m.role === "user" && !contentText(m).startsWith("Earlier in this conversation")));
  const contextText = messages.filter((m) => m.role === "user").map(contentText).find((t) => t.startsWith("Earlier in this conversation")) ?? "";
  const { topic: question, only } = readQuestion(asked, contextText);
  const calls = messages.filter((m) => m.role === "assistant").flatMap((m) => m.tool_calls ?? []);
  const results = new Map();
  for (const m of messages) if (m.role === "tool") results.set(m.tool_call_id, toolData(contentText(m)));
  const resultOf = (name) => {
    const call = [...calls].reverse().find((c) => c.function?.name === name);
    return call ? results.get(call.id) : undefined;
  };
  const resultsOf = (name) => calls.filter((c) => c.function?.name === name).map((c) => results.get(c.id)).filter((r) => r !== undefined);
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
  // Records Nexus supplied with a "not accepted yet" reply to an earlier final_answer.
  const supplied = resultsOf("final_answer").flatMap((r) => r?.issues ?? []);
  const answered = resultsOf("final_answer").length > 0;
  const sectionOk = section && !section.error ? section : null;
  const pages = resultsOf("query_issues");
  if (!answered) {
    if (variant === "noissues") {
      // Imitates the live model Codex saw: no issue lookup at all, then a free-text claim.
      return { tool_calls: [toolCall("final_answer", { facts: sectionOk ? [{ text: "The judge instructions do not appear on the board.", sources: [sectionOk.handle] }] : [], discrepancies: [], suggestions: [], tracking: [], insufficientEvidence: false, insufficientReason: null }, n)] };
    }
    if (variant === "narrow" && sectionOk) {
      // Imitates the live models: one text lookup per action, owner's name included.
      const actions = (sectionOk.actions ?? []).map((a) => a.text);
      if (pages.length < actions.length) return { tool_calls: [toolCall("query_issues", { text: actions[pages.length] }, n)] };
    } else {
      if (pages.length === 0) return { tool_calls: [toolCall("query_issues", {}, n)] };
      // Read the remaining records before deciding that an item has no issue (except -lazy).
      const lastPage = pages.at(-1);
      if (variant !== "lazy" && lastPage?.nextOffset !== null && lastPage?.nextOffset !== undefined) {
        return { tool_calls: [toolCall("query_issues", { offset: lastPage.nextOffset }, n)] };
      }
    }
  }
  const seen = new Set();
  // Whatever the lookups returned (for -narrow, the project's records after an empty lookup).
  const fromPages = pages.flatMap((p) => p?.issues ?? []);
  const issues = [...fromPages, ...supplied].filter((i) => !seen.has(i.key) && seen.add(i.key));
  const answer = buildAnswer({ section: sectionOk, issues, invent: variant === "invent", citeIssues: variant !== "nocite", only, headingLinks: variant === "heading" });
  return { tool_calls: [toolCall("final_answer", answer, n)] };
}

/** Retrieval-first: the data arrives in one user message as JSON after a marker. */
function structuredAnswer(body, variant) {
  const text = (body.messages ?? []).map(contentText).join("\n");
  const marker = text.indexOf("RETRIEVED_DATA_JSON:");
  const data = marker >= 0 ? parseJson(text.slice(marker + "RETRIEVED_DATA_JSON:".length).trim().split("\nEND_RETRIEVED_DATA")[0]) : null;
  const { topic: question, only } = readQuestion(data?.question ?? "", data?.conversationContext ?? "");
  const sections = data?.sections ?? [];
  const best = chooseSection(sections, question);
  return buildAnswer({ section: best, issues: data?.issues ?? [], invent: variant === "invent", citeIssues: variant !== "nocite", only });
}

const UNSURE = { facts: [], discrepancies: [], suggestions: [], insufficientEvidence: true, insufficientReason: "Fixture variant: always reports insufficient evidence." };

export function handleChat(body) {
  const model = String(body.model ?? "");
  const variant = model.replace(/^nexus-test-double-?/, "") || "tools";
  const wantsTools = Array.isArray(body.tools) && body.tools.length > 0;
  const schemaName = body.response_format?.json_schema?.name;
  if (variant === "structured" && wantsTools) return { status: 400, body: { error: { message: "This model does not support tools.", type: "invalid_request_error" } } };
  if (variant === "none" && (wantsTools || body.response_format)) return { status: 400, body: { error: { message: "This model supports neither tools nor response_format.", type: "invalid_request_error" } } };
  const reply = (message) => ({ status: 200, body: { id: "chatcmpl-fixture", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: null, ...message }, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] } });
  // Capability probes.
  if (wantsTools && body.tools.some((t) => t.function?.name === "ping")) return reply({ tool_calls: [toolCall("ping", { value: "nexus" }, 1)] });
  if (schemaName === "probe") return reply({ content: JSON.stringify({ ok: true }) });
  if (variant === "plain") return reply({ content: "Here is a friendly answer without any structure." });
  if (variant === "unsure") return schemaName === "final_answer" ? reply({ content: JSON.stringify(UNSURE) }) : reply({ tool_calls: [toolCall("final_answer", UNSURE, 1)] });
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
      const isToolProbe = Array.isArray(body.tools) && body.tools.some((t) => t.function?.name === "ping");
      const isProbe = isToolProbe || body.response_format?.json_schema?.name === "probe";
      if (model.endsWith("-echo") && !(isProbe && !isToolProbe)) {
        // Like some real providers, echo the credential back in an error message: the whole
        // key for the tool probe (a non-fatal 400), and a long fragment for a real question.
        const token = auth.slice("Bearer ".length);
        const echoed = isToolProbe ? token : `${token.slice(0, 16)}…`;
        return send(400, { error: { message: `Tools are not enabled for key ${echoed}.\u001b[31m\nCheck your plan.`, type: "invalid_request_error" } });
      }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const d = await startProviderDouble(Number(process.argv[2] ?? 0));
  console.log(JSON.stringify({ event: "ready", baseUrl: d.baseUrl, note: "Test double: deterministic fixture, not AI." }));
}
