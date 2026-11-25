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
// Edit mode (propose_changes offered): for each untracked action, one fixed proposal of a new
// issue (owner dropped: "Write the judge instructions"), its heading link and the note line.
// A question such as "set NEX-1 due on 3 December" also proposes that due date.
// Corrections (CORRECTION_REQUEST_JSON in the question): the date or quoted line the reason
// names, on the same target, or nothing when it names none.
//   nexus-test-double-stray       corrects a different field, which Nexus refuses
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
  const correction = correctionRequest(asked);
  if (correction && editMode(body)) return correctionStep(correction, resultOf, variant, n);
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
  if (editMode(body)) {
    // Edit mode (the user chose Edit): propose the fixed plan once, then report what it did.
    const proposal = resultOf("propose_changes");
    const untracked = answer.tracking.filter((t) => t.status === "untracked");
    const dated = datedUpdates(asked, issues);
    if (proposal === undefined && sectionOk && (untracked.length || dated.length)) {
      const project = pages[0]?.projectsInWorkspace?.[0] ?? issues[0]?.key?.split("-")[0] ?? "NEX";
      const plan = editPlan(sectionOk, untracked, project);
      plan.operations.push(...dated);
      if (dated.length) plan.summary = `${plan.summary} Set ${dated.map((d) => `${d.issue} due ${d.value.date}`).join(", ")}.`;
      return { tool_calls: [toolCall("propose_changes", plan, n)] };
    }
    return { tool_calls: [toolCall("final_answer", editAnswer(answer, proposal, sectionOk), n)] };
  }
  return { tool_calls: [toolCall("final_answer", answer, n)] };
}

const editMode = (body) => Array.isArray(body.tools) && body.tools.some((t) => t.function?.name === "propose_changes");

/** "Will writes the judge instructions" → "Write the judge instructions" (owner dropped, verb as an instruction). */
export function issueTitle(action) {
  const w = action.trim().split(/\s+/);
  if (w.length >= 3 && /^[A-Z][a-z]+$/.test(w[0]) && /^[a-z]+s$/.test(w[1])) {
    const verb = /(ch|sh|ss|x|z)es$/.test(w[1]) ? w[1].slice(0, -2) : w[1].slice(0, -1);
    return [verb[0].toUpperCase() + verb.slice(1), ...w.slice(2)].join(" ");
  }
  return action.trim()[0].toUpperCase() + action.trim().slice(1);
}

/** The fixed Edit plan: for each untracked action, a new issue, its heading link and the note line. */
function editPlan(section, untracked, project) {
  const lines = section.text.split(/\r?\n/);
  const operations = [];
  untracked.forEach((t, i) => {
    const ref = `new-${i + 1}`;
    operations.push({ op: "create_issue", ref, project, title: issueTitle(t.action), description: `From ${section.headingPath.join(" › ")}: “${t.action}”.` });
    operations.push({ op: "link_issue", issue: ref, note: section.path, heading: section.headingSlug });
    const line = lines.find((l) => /^\s*[-*] \[( |x|X)\] /.test(l) && l.trimEnd().endsWith(t.action));
    if (line) operations.push({ op: "edit_note", note: section.path, heading: section.headingSlug ?? null, before: line, after: `${line.trimEnd()} ({{issue:${ref}}})` });
  });
  return { operations, summary: `Track ${untracked.length} untracked action${untracked.length === 1 ? "" : "s"} from ${section.headingPath.join(" › ")}.` };
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})\\b`, "i");

/** A date named in text, "2026-12-08" or "8 December" (the year from `year`), as { date }. */
export function dateIn(text, year = 2026) {
  const iso = String(text ?? "").match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}` };
  const dm = String(text ?? "").match(DAY_MONTH);
  if (!dm) return null;
  const month = MONTHS.indexOf(dm[2].toLowerCase()) + 1;
  return { date: `${year}-${String(month).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}` };
}
const yearOf = (due) => Number(String(due?.date ?? due?.dateTime ?? "").slice(0, 4)) || 2026;

/** Edit: "set NEX-1 due on 3 December" names an existing issue and a date: propose that date. */
function datedUpdates(question, issues) {
  const out = [];
  for (const m of String(question ?? "").matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d+)\b([^.]*?)\bdue\b([^.]*)/g)) {
    const issue = (issues ?? []).find((i) => i.key === m[1]);
    const value = issue ? dateIn(m[3], yearOf(issue.due)) : null;
    if (value) out.push({ op: "update_issue", issue: issue.key, field: "due", value });
  }
  return out;
}

/** The correction request Nexus sends after the user rejects a change and gives a reason. */
function correctionRequest(text) {
  const m = String(text ?? "").match(/^CORRECTION_REQUEST_JSON: (.+)$/m);
  return m ? parseJson(m[1]) : null;
}

const answerOf = ({ suggestions = [], insufficientReason = null }) => ({
  facts: [], discrepancies: [], suggestions, tracking: [], insufficientEvidence: insufficientReason !== null, insufficientReason,
});

/**
 * The fixed correction rule: look the target up, then propose the value the reason names (a
 * date for a due field, or a quoted line for note lines). With no such value, propose nothing
 * and say so. -stray proposes a different field, which Nexus must refuse.
 */
function correctionStep(req, resultOf, variant, n) {
  const t = req.target ?? {};
  const proposal = resultOf("propose_changes");
  let sources = [];
  if (t.kind === "field") {
    const looked = resultOf("query_issues");
    if (looked === undefined) return { tool_calls: [toolCall("query_issues", { keys: [t.issue] }, n)] };
    const issue = (looked?.issues ?? []).find((i) => i.key === t.issue);
    sources = issue ? [issue.handle] : [];
    if (proposal === undefined) {
      if (variant === "stray") return { tool_calls: [toolCall("propose_changes", { operations: [{ op: "update_issue", issue: t.issue, field: "priority", value: "low" }] }, n)] };
      const value = t.field === "due" ? dateIn(req.reason, yearOf(req.current ?? req.rejected?.after)) : null;
      if (value) return { tool_calls: [toolCall("propose_changes", { operations: [{ op: "update_issue", issue: t.issue, field: "due", value }], summary: `Use the date the reason gives for ${t.issue}.` }, n)] };
      return { tool_calls: [toolCall("final_answer", answerOf({ insufficientReason: "The reason does not name a date, so the test double proposed no change. Say which date to use." }), n)] };
    }
  } else if (t.kind === "note") {
    const section = resultOf("read_note_section");
    if (section === undefined) return { tool_calls: [toolCall("read_note_section", { path: t.note, headingSlug: t.heading ?? undefined }, n)] };
    sources = section?.handle ? [section.handle] : [];
    if (proposal === undefined) {
      const quoted = String(req.reason ?? "").match(/[“"]([^”"]+)[”"]/)?.[1];
      if (quoted && !section?.error) return { tool_calls: [toolCall("propose_changes", { operations: [{ op: "edit_note", note: t.note, heading: t.heading ?? null, before: t.lines, after: quoted }] }, n)] };
      return { tool_calls: [toolCall("final_answer", answerOf({ insufficientReason: "The reason does not quote the text to use, so the test double proposed no change." }), n)] };
    }
  }
  if (proposal === undefined) return { tool_calls: [toolCall("final_answer", answerOf({ insufficientReason: "The test double does not correct this kind of change." }), n)] };
  if (proposal?.error) return { tool_calls: [toolCall("final_answer", answerOf({ insufficientReason: `Nexus refused the correction: ${proposal.error}` }), n)] };
  return { tool_calls: [toolCall("final_answer", answerOf({ suggestions: (proposal?.changes ?? []).map((c) => ({ text: `Proposed for your review: ${c.summary}.`, sources })) }), n)] };
}

/** The answer after proposing: the grounded tracking, plus what was proposed (never "done"). */
function editAnswer(answer, proposal, section) {
  const sources = section ? [section.handle] : [];
  if (proposal?.error) {
    return { ...answer, suggestions: [], insufficientEvidence: true, insufficientReason: `Nexus refused the proposed changes: ${proposal.error}` };
  }
  const proposed = (proposal?.changes ?? []).map((c) => ({ text: `Proposed for your review: ${c.summary}.`, sources }));
  const none = proposal === undefined ? [{ text: "Nothing to change: every action already has a matching issue.", sources }] : [];
  return { ...answer, suggestions: [...proposed, ...none] };
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
