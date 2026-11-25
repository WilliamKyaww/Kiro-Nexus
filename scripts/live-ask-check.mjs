// Live check for Q1, run by Will with his own free key. Kiro does not run it live.
// It uses a disposable copy of the fictional sample and an isolated profile in the
// system temp folder, so no real notes leave the machine.
//
//   npm run build
//   npm run live:check        then paste the key at the masked prompt
//
// The key is read at a prompt that echoes "*", so it never appears on screen, in shell
// history or in an environment variable. It is sent to the disposable service over its
// API and from there only to the provider. Both processes exit and the temporary profile
// is deleted at the end; reports and console output are sanitised.
//
// Optional settings (environment variables):
//   NEXUS_LIVE_BASE_URL   default https://api.groq.com/openai/v1
//   NEXUS_LIVE_MODEL      default openai/gpt-oss-20b
//   NEXUS_LIVE_KEY        the key, for automated runs only (tests); removed from the
//                         environment at once and never passed to the service process
//   NEXUS_LIVE_OUT_DIR    where the report goes (default .tmp/live-check)
//   NEXUS_LIVE_ANSWER_TIMEOUT_MS  how long to wait for the answer (default 240000)
//
// Exit status: 0 live pass; 1 the answer failed a check; 2 setup or service error;
// 3 the provider rejected the key; 4 timed out; 5 the model lacks tool calling and
// structured output; 6 the transport worked but the provider was the test double
// (a fixture never counts as a live pass); 7 other provider error.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { redactSecrets, sanitiseDeep, sanitiseDiagnostic } from "../server/src/providers/sanitise.mjs";
import { repoRoot } from "./launcher-lib.mjs";

export const EXIT = { pass: 0, checkFailed: 1, setup: 2, auth: 3, timeout: 4, unsupported: 5, fixture: 6, provider: 7 };
const QUESTION = "Which action from the kickoff still has no issue?";
const NOTE_PATH = "meetings/2026-11-24 kickoff.md";
const STARTUP_MS = 20_000;
const REQUEST_MS = 15_000;
const PROBE_MS = 150_000; // two probes, each up to 30 s with one retry
const POLL_MS = 500;

class CheckError extends Error {
  constructor(exit, message) { super(message); this.exit = exit; }
}

const providerExit = (code) => ({ PROVIDER_AUTH: EXIT.auth, PROVIDER_TIMEOUT: EXIT.timeout, CANCELLED: EXIT.timeout }[code] ?? EXIT.provider);

/** SHA-256 of every note and of the project and issue data (conversations, lock and state excluded). */
export async function workspaceHashes(dir) {
  const out = {};
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      const rel = relative(dir, p).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (rel === ".nexus/conversations" || rel === ".nexus/state" || rel === ".nexus/reviews") continue;
        await walk(p);
      } else if (rel.endsWith(".md") || rel === ".nexus/issues.json" || rel === ".nexus/projects.json") {
        out[rel] = createHash("sha256").update(await readFile(p)).digest("hex");
      }
    }
  };
  await walk(dir);
  return out;
}

/** The issue created between the two turns, through the ordinary issue API. */
export const NEW_ISSUE_TITLE = "Write the judge instructions";

/**
 * The journey the check expects, in one fictional workspace. The kickoff sample is the one the
 * CLI runs; the tests also use a second vocabulary, so nothing in the evaluator depends on the
 * kickoff's words (R4-4).
 */
export const KICKOFF = {
  notePath: NOTE_PATH, headingSlug: "actions", heading: "Actions",
  missing: { action: "Will writes the judge instructions", label: "Will's judge instructions", issueAfter: "NEX-2" },
  tracked: { action: "Hein builds the calendar view", label: "Hein's calendar work", issue: "NEX-1" },
};

// The same content words Nexus uses (server/src/ask/answer.ts contentWords).
const contentWords = (text) => new Set((String(text).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).map((w) => w.replace(/(ings?|ed|es|s)$/, "").replace(/e$/, "")).filter((w) => w.length >= 3));
/** Whether a tracking entry is for an action: at least half of the action's content words appear in it. */
const refersTo = (text, action) => {
  const want = contentWords(action);
  const have = contentWords(text);
  return want.size > 0 && [...want].filter((w) => have.has(w)).length / want.size >= 0.5;
};
/** The words that identify an action, without its leading owner ("Hein builds …"); as in answer.ts actionWords. */
const actionWords = (action) => {
  const tokens = String(action).trim().split(/\s+/);
  const owner = tokens.length >= 3 && /^[A-Z][a-z]+$/.test(tokens[0]) && /^[a-z]+s$/.test(tokens[1]) ? [...contentWords(tokens[0])][0] : null;
  const words = contentWords(action);
  if (owner) words.delete(owner);
  return words;
};
/** Whether a recorded statement is about an action: it shares a word that identifies the action. */
const isAbout = (text, action) => { const have = contentWords(text); return [...actionWords(action)].some((w) => have.has(w)); };

// The record values a statement states, read the same way as Nexus (answer.ts datesIn,
// valuesIn, clausesOf and uncheckedWords) but written again here, so that the check does not
// reuse the code it checks.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const datesIn = (text) => {
  const out = [];
  const push = (year, month, day) => { if (month >= 1 && month <= 12 && day >= 1 && day <= 31) out.push({ year, month, day }); };
  const month = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const s = String(text);
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, "gi"))) push(m[3] ? Number(m[3]) : null, month(m[2]), Number(m[1]));
  for (const m of s.matchAll(new RegExp(`\\b${MONTH}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, "gi"))) push(m[3] ? Number(m[3]) : null, month(m[1]), Number(m[2]));
  return out;
};
// Ordinary status wording (R6-6): "under way" and "started" are in progress, "not started" is
// to do, and "finished" or "complete" is done.
const STATUS_WORDS = [
  [/\bto[ -]?do\b/gi, "todo"], [/\bin[ _-]progress\b/gi, "in_progress"], [/\bunder[ -]?way\b/gi, "in_progress"], [/\bongoing\b/gi, "in_progress"],
  [/\b(?:started|begun)\b/gi, "in_progress", "started"], [/\b(?:done|finished|completed?|ticked)\b/gi, "done"], [/\b(?:unfinished|incomplete|unticked)\b/gi, "done", "negative"],
];
/**
 * The dates and statuses one clause states, each with whether it is negated (R6-6): "not",
 * "isn't", "never" or "no longer" just before a status, or up to three words before a date
 * ("not due on"). "Not due until 5 December" states 5 December. A negation never reaches back
 * past an earlier value. Each value keeps its span, so the words it uses can be set aside.
 */
const valuesIn = (text) => {
  const s = String(text);
  const month = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const found = [];
  const date = (m, year, mo, day) => { if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) found.push({ start: m.index, end: m.index + m[0].length, date: { year, month: mo, day } }); };
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) date(m, Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, "gi"))) date(m, m[3] ? Number(m[3]) : null, month(m[2]), Number(m[1]));
  for (const m of s.matchAll(new RegExp(`\\b${MONTH}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, "gi"))) date(m, m[3] ? Number(m[3]) : null, month(m[1]), Number(m[2]));
  for (const [form, status, kind] of STATUS_WORDS) for (const m of s.matchAll(form)) found.push({ start: m.index, end: m.index + m[0].length, status, kind });
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const dates = [];
  const statuses = [];
  let last = 0;
  for (const v of found) {
    if (v.start < last) continue;
    const before = s.slice(last, v.start);
    if (v.date) {
      const n = before.match(/(?:\b(?:not|never)|n['’]t|\bno longer)((?:\s+[a-z’']+){0,3})\s*$/i);
      dates.push({ date: v.date, negated: !!n && !/\b(?:until|till)\b/i.test(n[1] ?? ""), start: n ? last + n.index : v.start, end: v.end });
    } else {
      const n = before.match(/(?:\b(?:not|never)|n['’]t|\bno longer)\s+(?:(?:yet|been|being|currently|actually|really|fully|even|ever|already|quite|still)\s+)*$/i);
      const negated = !!n !== (v.kind === "negative");
      const start = n ? last + n.index : v.start;
      statuses.push(v.kind === "started" && negated ? { status: "todo", negated: false, start, end: v.end } : { status: v.status, negated, start, end: v.end });
    }
    last = v.end;
  }
  return { dates, statuses };
};
/** A statement's clauses: its sentences, and their parts joined by ";", "but", "and", "while", "whereas", "although", "though" or "however". Quotations and brackets stay whole. */
const clausesOf = (text) => {
  const s = String(text);
  const masked = s.replace(/“[^”]*”|"[^"]*"|\([^)]*\)/g, (m) => "#".repeat(m.length));
  const out = [];
  let from = 0;
  for (const m of masked.matchAll(/[.!?]+(?=\s+[A-Z“"‘(#]|\s*$)|\s*;\s*|,?\s+(?:but|and|while|whereas|although|though|however)\b,?(?=\s)/g)) {
    out.push(s.slice(from, m.index));
    from = m.index + m[0].length;
  }
  out.push(s.slice(from));
  return out.map((c) => c.trim()).filter(Boolean);
};
/**
 * The words that may surround a checked value in a statement about one of the journey's actions
 * (R6-6), besides the actions' own words and the names of the cited sources. Any other word
 * ("no", "matching", "untracked") says something that the issue's values cannot show.
 */
const PLAIN_WORDS = new Set(`a an the this that these those it its their his her both which who whose
  is are was were be been being has have had does do did will would should can could may might must
  on in at by for of to from with as into under about per according and but while whereas although though however also so
  still already currently now yet due date dated deadline set scheduled planned expected
  issue record card task action item work ticket entry note marks marked lists listed shows says records recorded states
  section heading checklist checkbox meeting board project`.split(/\s+/).filter(Boolean));
const NEGATIVE_WORDS = new Set(["no", "not", "none", "never", "nothing", "nobody", "neither", "nor", "without", "cannot", "untracked", "missing", "lack", "lacks", "lacking", "absent"]);
const wordsIn = (text) => String(text).toLowerCase().replace(/[’']s\b/g, "").match(/[a-z0-9]+(?:['’][a-z]+)*/g) ?? [];
// Words of four or more letters also match by their content-word stem; shorter ones only as
// written, so that "not" never matches "note".
const stemOf = (w) => [...contentWords(w)][0] ?? w;
const inWords = (list) => {
  const exact = new Set(list);
  const stems = new Set([...exact].filter((w) => w.length >= 4).map(stemOf));
  return (w) => exact.has(w) || (w.length >= 4 && stems.has(stemOf(w)));
};
const isPlain = inWords(PLAIN_WORDS);
/** The words of a statement that are not a stated value, a cited key, a plain word, or a word of `allowed`. */
const uncheckedWords = (text, keys, allowed) => {
  const isAllowed = inWords(allowed.flatMap(wordsIn));
  const out = new Set();
  for (const clause of clausesOf(text)) {
    const { dates, statuses } = valuesIn(clause);
    let rest = clause;
    for (const v of [...dates, ...statuses]) rest = rest.slice(0, v.start) + " ".repeat(v.end - v.start) + rest.slice(v.end);
    for (const key of keys) rest = rest.replace(new RegExp(`\\b${key.replace(/[^A-Za-z0-9]/g, "\\$&")}\\b`, "gi"), (m) => " ".repeat(m.length));
    for (const w of wordsIn(rest)) if (NEGATIVE_WORDS.has(w) || (!isPlain(w) && !isAllowed(w))) out.add(w);
  }
  return [...out];
};
const namesKey = (text, key) => new RegExp(`\\b${key.replace(/[^A-Za-z0-9]/g, "\\$&")}\\b`, "i").test(String(text));
const sameDate = (a, b) => a.month === b.month && a.day === b.day && (a.year === null || b.year === null || a.year === b.year);
/** The dates a due value can be quoted as: its date, or a timed value's local and UTC dates. */
const dueDates = (due) => {
  if (!due) return [];
  if (typeof due.date === "string") { const [year, month, day] = due.date.split("-").map(Number); return [{ year, month, day }]; }
  const instant = new Date(due.dateTime);
  if (Number.isNaN(instant.getTime())) return [];
  const utc = { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() };
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: due.timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(instant).map((x) => [x.type, x.value]));
    return [{ year: Number(p.year), month: Number(p.month), day: Number(p.day) }, utc];
  } catch { return [utc]; }
};
const STATUS_TEXT = { todo: "to do", in_progress: "in progress", done: "done" };

/**
 * Pure evaluation of one stored answer in the two-turn journey (also used by the browser
 * test). It compares the structured tracking entries, which Nexus has checked against the
 * run's evidence, with what the answer shows as recorded (R5-3):
 *   turn 1: the missing action is untracked, and the tracked action's issue tracks it;
 *   turn 2 (after the new issue is created): the new issue tracks the missing action too.
 * Each expected entry must be confirmed, and Nexus's sentence for it, in the entry's own
 * wording of the action, must be among the recorded facts. Any other recorded fact or
 * discrepancy about either action must be an ordinary statement about the issue that tracks
 * it: it cites that issue and states one of its values (status or due date) as the record has
 * it. One that states none, such as a denial of the match, fails the turn whatever its wording
 * (R4-4, R5-3).
 *
 * `records` are the issue records from the API. Without them (the browser test passes only
 * the keys) the values are required but not compared.
 */
export function evaluateTurn(message, turn, { actionsHeadingExists, existingIssues, records = null, scenario = KICKOFF }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name: `Turn ${turn}: ${name}`, ok, detail });
  const a = message?.answer;
  add("answer completed", message?.status === "complete" && !!a, message?.status ?? "no answer");
  if (!a) return checks;
  add("evidence sufficient", !a.insufficientEvidence, a.insufficientEvidence ? (a.insufficientReason ?? "insufficient evidence") : "ok");
  const { missing, tracked, heading } = scenario;
  const cites = a.citations ?? {};
  const isSection = (h) => cites[h]?.target?.kind === "note" && cites[h].target.path === scenario.notePath && cites[h].target.headingSlug === scenario.headingSlug;
  const isIssue = (key) => (h) => cites[h]?.target?.kind === "issue" && cites[h].target.key === key;
  const keyOf = (h) => cites[h]?.target?.key ?? h;
  const isNote = (h) => cites[h]?.target?.kind === "note";
  const recordOf = (key) => (records ?? []).find((r) => r.key === key) ?? null;
  const facts = a.facts ?? [];
  const entries = (a.tracking ?? []);
  /** Whether a text is Nexus's sentence for an entry, naming the expected issue (as the record has it, when given). */
  const sentenceFor = (text, t, issueKey) => {
    if (issueKey === null) return text === `“${t.action}” has no matching issue.`;
    if (!text.startsWith(`“${t.action}” is tracked by `)) return false;
    const rec = recordOf(issueKey);
    return text.includes(rec ? `${issueKey} (${rec.title}, ${STATUS_TEXT[rec.status] ?? rec.status})` : `${issueKey} (`);
  };
  const shown = (t, issueKey) => facts.some((f) => sentenceFor(f.text, t, issueKey));
  const describe = (list, issueKey) => list.length ? list.map((t) => `${t.status}${t.issues.length ? ` by ${t.issues.map(keyOf).join(", ")}` : ""}${t.confirmed ? "" : ` (not confirmed: ${t.problem})`}${t.confirmed && issueKey !== undefined && !shown(t, issueKey) ? " (confirmed, but Nexus's sentence for it is not among the recorded facts)" : ""}`).join("; ") : "no tracking entry for this action";
  const forMissing = entries.filter((t) => refersTo(t.action, missing.action));
  const forTracked = entries.filter((t) => refersTo(t.action, tracked.action));
  const missingIssue = turn === 1 ? null : missing.issueAfter;
  const missingClaim = (t) => t.confirmed && isSection(t.source) && (missingIssue === null ? t.status === "untracked" : t.status === "tracked" && t.issues.some(isIssue(missingIssue)));
  const trackedClaim = (t) => t.confirmed && isSection(t.source) && t.status === "tracked" && t.issues.some(isIssue(tracked.issue));
  // The structured claim must be correct and confirmed, and also shown as a recorded fact.
  const okMissing = forMissing.filter((t) => missingClaim(t) && shown(t, missingIssue));
  const okTracked = forTracked.filter((t) => trackedClaim(t) && shown(t, tracked.issue));
  add(missingIssue === null
    ? `${missing.label} are untracked, from the ${heading} heading, confirmed by the evidence`
    : `${missing.label} are tracked by ${missingIssue}, from the ${heading} heading, confirmed by the evidence`, okMissing.length > 0, describe(forMissing, missingIssue));
  add(`${tracked.label} is tracked by ${tracked.issue}, from the ${heading} heading, confirmed by the evidence`, okTracked.length > 0, describe(forTracked, tracked.issue));
  // A correct entry must not sit beside a confirmed entry that says the opposite.
  const contradictions = [...forMissing.filter((t) => t.confirmed && !missingClaim(t)), ...forTracked.filter((t) => t.confirmed && !trackedClaim(t))];
  add("no confirmed entry contradicts these", contradictions.length === 0, contradictions.length ? describe(contradictions) : "none");
  /**
   * Why a recorded statement about an action is not an ordinary statement about the issue
   * that tracks it, or null when it is (R4-4, R5-3, R6-6). It must cite that issue, state at
   * least one of its values as the record has it, and say nothing else than the values the
   * issue can show: every other word must be a plain word, a word of the actions or a word of
   * a cited source's name. Each clause is compared with the record it names (else the previous
   * clause's, else the issue's). A recorded fact must contradict none of the values (a date may
   * instead be one in a cited note's name); a negated date that is the due date contradicts it
   * in a discrepancy too. A discrepancy may state the note's status.
   */
  const notOrdinary = (item, kind, issueKey) => {
    if (issueKey === null) return "only Nexus's own sentence may say whether this action has an issue";
    const sources = item.sources ?? [];
    if (!sources.some(isIssue(issueKey))) return `it does not cite ${issueKey}`;
    const clauses = clausesOf(item.text).map((text) => ({ text, ...valuesIn(text) }));
    // "Not done" fits two statuses and "not due on 3 December" every other date, so neither
    // pins down a value of the record.
    if (!clauses.some((c) => c.dates.some((d) => !d.negated) || c.statuses.some((s) => !s.negated))) return `it states none of ${issueKey}'s values, so it can only restate or deny the tracking result`;
    const citedKeys = sources.map((h) => cites[h]?.target?.kind === "issue" ? cites[h].target.key : null).filter(Boolean);
    const allowed = [missing.action, tracked.action, ...entries.map((t) => t.action ?? ""), ...sources.flatMap((h) => [cites[h]?.label ?? "", cites[h]?.target?.path ?? "", cites[h]?.target?.headingText ?? ""])];
    const extra = uncheckedWords(item.text, citedKeys, allowed);
    if (extra.length) return `it says more than ${issueKey}'s values can show (“${extra.join("”, “")}”), so it can restate or deny the tracking result`;
    if (!records) return null;
    const rec = recordOf(issueKey);
    if (!rec) return `${issueKey} is not among the issue records`;
    const asRecorded = `${issueKey} is ${STATUS_TEXT[rec.status] ?? rec.status}, ${rec.due ? `due ${rec.due.date ?? rec.due.dateTime}` : "with no due date"}`;
    const noteDates = sources.filter(isNote).flatMap((h) => datesIn(`${cites[h].target.path ?? ""} ${cites[h].label ?? ""}`));
    let current = rec;
    let pinned = false;
    let contradicts = false;
    let negatedDue = false;
    for (const c of clauses) {
      current = records.find((r) => namesKey(c.text, r.key)) ?? current;
      for (const d of c.dates) {
        const onDue = dueDates(current.due).some((x) => sameDate(d.date, x));
        if (d.negated) { if (onDue) negatedDue = true; continue; }
        if (onDue && current.key === issueKey) pinned = true;
        if (!onDue && !noteDates.some((x) => sameDate(d.date, x))) contradicts = true;
      }
      for (const s of c.statuses) {
        const holds = (current.status === s.status) !== s.negated;
        if (holds && !s.negated && current.key === issueKey) pinned = true;
        if (!holds) contradicts = true;
      }
    }
    if (negatedDue) return `it denies a due date that the record holds (${asRecorded})`;
    if (!pinned) return `it states none of ${issueKey}'s values as the record has them (${asRecorded})`;
    if (kind === "fact" && contradicts) return `it contradicts the record (${asRecorded})`;
    return null;
  };
  const stray = [];
  for (const [kind, list] of [["fact", facts], ["discrepancy", a.discrepancies ?? []]]) {
    for (const item of list) {
      for (const [action, issueKey, ok] of [[missing.action, missingIssue, okMissing], [tracked.action, tracked.issue, okTracked]]) {
        // A statement is about an action when it shares a word that identifies the action, or
        // when it cites or names the issue that tracks it (R6-6: "It has no matching issue.
        // NEX-1 is due on 5 December.").
        const aboutIssue = issueKey !== null && (namesKey(item.text, issueKey) || (item.sources ?? []).some(isIssue(issueKey)));
        if (!isAbout(item.text, action) && !aboutIssue) continue;
        if (kind === "fact" && ok.some((t) => sentenceFor(item.text, t, issueKey))) continue;
        const why = notOrdinary(item, kind, issueKey);
        if (why) stray.push(`${kind}: ${item.text} (${why})`);
      }
    }
  }
  add("the recorded facts and discrepancies say nothing else about these actions", stray.length === 0, stray.length ? stray.join(" | ") : "none");
  add(`the ${heading} heading citation opens`, Object.keys(cites).some(isSection) && actionsHeadingExists, actionsHeadingExists ? "heading exists" : "heading not found");
  for (const key of missingIssue === null ? [tracked.issue] : [tracked.issue, missingIssue]) {
    add(`the ${key} citation opens`, Object.keys(cites).some(isIssue(key)) && existingIssues.has(key), existingIssues.has(key) ? (Object.keys(cites).some(isIssue(key)) ? "cited and exists" : "not cited") : "issue not found");
  }
  return checks;
}

/** Remove the key, fragments of it and key-shaped strings, keeping the layout. */
export function sanitiseReport(text, keys) {
  return redactSecrets(text, keys);
}

/**
 * Read a line from a terminal without showing it: each character echoes as "*".
 * Returns null when the input is not a terminal. Raw mode is always restored.
 */
export function promptHidden(question, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== "function") return Promise.resolve(null);
  output.write(question);
  return new Promise((resolve) => {
    let value = "";
    const finish = (result) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      resolve(result);
    };
    const onData = (chunk) => {
      const raw = String(chunk);
      if (raw === "\u001b") return finish(null); // Esc on its own: give up
      // Drop bracketed-paste markers and cursor keys rather than treating them as input.
      const text = raw.replace(/\u001b\[[0-9;]*[A-Za-z~]/g, "");
      for (const ch of text) {
        if (ch === "\r" || ch === "\n") return finish(value);
        if (ch === "\u0003") return finish(null); // Ctrl+C: give up
        if (ch === "\u007f" || ch === "\b") {
          if (value) { value = value.slice(0, -1); output.write("\b \b"); }
          continue;
        }
        if (ch < " ") continue;
        value += ch;
        output.write("*");
      }
    };
    input.setRawMode(true);
    input.setEncoding?.("utf8");
    input.on("data", onData);
    input.resume();
  });
}

let activeKey = "";
/** Console output passes through the same sanitiser as the report. */
const say = (line) => console.log(sanitiseDiagnostic(line, { keys: [activeKey], max: 2000 }));

async function readKey() {
  // A key in the environment works for automation, but is removed at once so that the
  // service child process and anything else started from here never inherit it.
  const fromEnv = process.env.NEXUS_LIVE_KEY?.trim();
  delete process.env.NEXUS_LIVE_KEY;
  if (fromEnv) return fromEnv;
  const typed = await promptHidden("Paste your provider key (it is not shown, saved or logged), then press Enter: ");
  return typed?.trim() || null;
}

async function main() {
  const key = await readKey();
  activeKey = key ?? "";
  if (!key) throw new CheckError(EXIT.setup, "No key was given. Run npm run live:check in a terminal and paste the key when asked. Nothing was sent.");
  const baseUrl = process.env.NEXUS_LIVE_BASE_URL ?? "https://api.groq.com/openai/v1";
  const model = process.env.NEXUS_LIVE_MODEL ?? "openai/gpt-oss-20b";
  const answerTimeoutMs = Number(process.env.NEXUS_LIVE_ANSWER_TIMEOUT_MS ?? 240_000);
  const outDir = process.env.NEXUS_LIVE_OUT_DIR ?? join(repoRoot, ".tmp", "live-check");
  const bundle = join(repoRoot, "server", "dist", "main.mjs");
  const report = {
    date: new Date().toISOString(), baseUrl, model, provider: (() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })(),
    question: QUESTION, verdict: "error", exitCode: EXIT.setup, liveProvider: null, capabilities: null, checks: [], turns: [], error: null, servicePid: null,
  };
  let child = null;
  let base = null;
  let control = null;
  let port = null;

  const stopService = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once("exit", r));
    if (port && control) {
      await fetch(`http://127.0.0.1:${port}/api/v1/shutdown`, { method: "POST", headers: control, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
    }
    const kill = setTimeout(() => child.kill(), 5000);
    let giveUp;
    await Promise.race([exited, new Promise((r) => { giveUp = setTimeout(r, 8000); })]);
    clearTimeout(kill);
    clearTimeout(giveUp);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  // Last resort if the process is torn down: never leave the service running.
  const killNow = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill(); };
  process.once("exit", killNow);
  const onSignal = (sig) => { killNow(); process.exit(128 + (sig === "SIGINT" ? 2 : 15)); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    if (!existsSync(bundle)) throw new CheckError(EXIT.setup, "The service is not built. Run: npm run build");
    base = await mkdtemp(join(tmpdir(), "nexus-live-"));
    const ws = join(base, "ws");
    const profile = join(base, "profile");
    await cp(join(repoRoot, "samples", "meeting-workspace"), ws, { recursive: true });
    const env = { ...process.env };
    delete env.NEXUS_LIVE_KEY; // the service gets the key over its API, never through its environment
    child = spawn(process.execPath, [bundle, "--profile", profile, "--workspace", ws], { stdio: ["ignore", "pipe", "pipe"], env });
    report.servicePid = child.pid;
    child.stderr.resume(); // service logs stay in the disposable profile
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CheckError(EXIT.timeout, `The Nexus service did not start within ${STARTUP_MS / 1000} s.`)), STARTUP_MS);
      createInterface({ input: child.stdout }).on("line", (l) => {
        let m;
        try { m = JSON.parse(l); } catch { return; }
        if (m.event === "ready") { clearTimeout(timer); resolve(m.port); }
        if (m.event === "error") { clearTimeout(timer); reject(new CheckError(EXIT.setup, `The Nexus service could not start (${m.code}).`)); }
      });
      child.once("exit", (code) => { clearTimeout(timer); reject(new CheckError(EXIT.setup, `The Nexus service exited during start-up (code ${code}).`)); });
    });
    const info = JSON.parse(await readFile(join(profile, "service.json"), "utf8"));
    control = { authorization: `Bearer ${info.controlSecret}` };

    const http = async (method, path, { body, headers = {}, timeoutMs = REQUEST_MS, expect = [200] } = {}) => {
      let res;
      try {
        res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
          method,
          // Declare JSON only when a body is sent: an empty JSON body is a 400 before any route runs.
          headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (e?.name === "TimeoutError") throw new CheckError(EXIT.timeout, `${method} ${path} did not answer within ${Math.round(timeoutMs / 1000)} s.`);
        throw new CheckError(EXIT.setup, `${method} ${path} failed: ${e?.message ?? e}`);
      }
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!expect.includes(res.status)) {
        const err = new CheckError(EXIT.setup, `${method} ${path} returned ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
        err.status = res.status;
        err.body = json;
        throw err;
      }
      return json;
    };

    const { launchCode } = await http("POST", "/launch-codes", { headers: control });
    const { token } = await http("POST", "/session", { body: { launchCode } });
    const auth = { authorization: `Bearer ${token}` };
    const api = (method, path, opts = {}) => http(method, path, { ...opts, headers: auth });

    const profileView = await api("POST", "/providers", { body: { name: "Live check", baseUrl, model }, expect: [201] });
    await api("PUT", `/providers/${profileView.id}/session-key`, { body: { key } });
    let tested;
    try {
      tested = await api("POST", `/providers/${profileView.id}/test`, { timeoutMs: PROBE_MS });
    } catch (e) {
      const providerCode = e.body?.error?.details?.providerCode;
      if (providerCode) throw new CheckError(providerExit(providerCode), `Provider test failed (${providerCode}): ${e.body.error.message}`);
      throw e;
    }
    const caps = tested?.profile?.capabilities;
    if (!caps) throw new CheckError(EXIT.setup, "The provider test returned no capabilities.");
    report.capabilities = caps;
    say(`Capabilities: tool calling ${caps.toolCalling}, structured output ${caps.structuredOutput}${caps.detail ? ` (${caps.detail})` : ""}`);
    let fixture = caps.fixture === true || /^nexus-test-double/.test(model);
    if (caps.toolCalling !== "yes" && caps.structuredOutput !== "yes") {
      if (caps.toolCalling === "error" || caps.structuredOutput === "error") {
        throw new CheckError(EXIT.provider, `The capability probes failed: ${caps.detail ?? "no detail"}`);
      }
      throw new CheckError(EXIT.unsupported, "The model showed neither tool calling nor structured output, so Ask cannot use it.");
    }

    const conversation = await api("POST", "/conversations", { body: {}, expect: [201] });
    /** Ask in the conversation through the normal Ask path and wait (bounded) for the stored answer. */
    const askAndWait = async (question) => {
      const { runId } = await api("POST", `/conversations/${conversation.id}/ask`, { body: { question }, expect: [202] });
      if (!runId) throw new CheckError(EXIT.setup, "The service accepted the question but returned no run ID.");
      const deadline = Date.now() + answerTimeoutMs;
      for (;;) {
        if (Date.now() > deadline) {
          await api("POST", `/ask-runs/${runId}/cancel`, { body: {} }).catch(() => undefined);
          throw new CheckError(EXIT.timeout, `No answer within ${Math.round(answerTimeoutMs / 1000)} s. The run was cancelled.`);
        }
        const c = await api("GET", `/conversations/${conversation.id}`);
        const message = c.messages.find((m) => m.role === "assistant" && m.runId === runId && m.status !== "running");
        if (message) return message;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    };
    const issueRecords = async () => (await api("GET", "/issues"))?.issues ?? [];
    const note = await api("GET", `/notes/content?path=${encodeURIComponent(NOTE_PATH)}`);
    const actionsHeadingExists = (note?.headings ?? []).some((h) => h.slug === "actions");
    report.turns = [];
    report.checks = [];

    for (const turn of [1, 2]) {
      if (turn === 2) {
        // The user's manual step between the turns: create the missing issue through the issue API.
        const project = ((await api("GET", "/projects"))?.projects ?? []).find((p) => p.key === "NEX");
        if (!project) throw new CheckError(EXIT.setup, "The disposable sample has no NEX project.");
        const created = await api("POST", "/issues", { body: { projectId: project.id, title: NEW_ISSUE_TITLE }, expect: [201] });
        say(`Created ${created.key} "${NEW_ISSUE_TITLE}" through the issue API.`);
      }
      const before = await workspaceHashes(ws);
      const message = await askAndWait(QUESTION);
      const after = await workspaceHashes(ws);
      const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
      report.turns.push({ turn, question: QUESTION, status: message.status, error: message.error, meta: message.meta, answer: message.answer, changedByAsk: changed });
      fixture ||= message.meta?.fixture === true;
      report.liveProvider = !fixture;
      if (message.status !== "complete") {
        const code = message.error?.code ?? "UNKNOWN";
        throw new CheckError(providerExit(code), `Turn ${turn} was not answered (${code}): ${message.error?.message ?? ""}`);
      }
      // The records let the check compare what the answer states about an issue with the issue.
      const records = await issueRecords();
      const checks = [
        ...evaluateTurn(message, turn, { actionsHeadingExists, existingIssues: new Set(records.map((i) => i.key)), records }),
        { name: `Turn ${turn}: Ask left the notes and issues unchanged`, ok: changed.length === 0, detail: changed.length ? `changed: ${changed.join(", ")}` : "byte-for-byte unchanged" },
      ];
      report.checks.push(...checks);
      for (const c of checks) say(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok ? "" : `: ${c.detail}`}`);
      const failed = checks.filter((c) => !c.ok);
      if (failed.length) throw new CheckError(EXIT.checkFailed, `${failed.length} check${failed.length === 1 ? "" : "s"} failed in turn ${turn}.`);
    }
    if (fixture) throw new CheckError(EXIT.fixture, "The transport and checks worked, but the provider is the local test double, which is a fixture and never counts as a live pass.");
    report.verdict = "live pass";
    report.exitCode = EXIT.pass;
  } catch (e) {
    const exit = e instanceof CheckError ? e.exit : EXIT.setup;
    report.verdict = { [EXIT.checkFailed]: "check failed", [EXIT.auth]: "authentication failed", [EXIT.timeout]: "timed out", [EXIT.unsupported]: "unsupported capabilities", [EXIT.fixture]: "fixture, not a live pass", [EXIT.provider]: "provider error" }[exit] ?? "error";
    report.exitCode = exit;
    report.error = String(e?.message ?? e);
  } finally {
    await stopService();
    process.off("exit", killNow);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (base) await rm(base, { recursive: true, force: true }).catch(() => undefined);
  }

  // Every string in the report is sanitised value by value, so the JSON stays valid.
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `live-check-${report.date.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(sanitiseDeep(report, { keys: [key], max: 4000 }), null, 2) + "\n");
  say(`Result: ${report.verdict} (exit ${report.exitCode}).${report.error ? ` ${report.error}` : ""}`);
  say(`Report saved to ${file}.`);
  if (report.exitCode === EXIT.pass) say("Record the provider, model, date and capabilities in docs/judge-ai-route.md and STATE.md, then close Q1.");
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    const text = sanitiseDiagnostic(String(e?.message ?? e), { keys: [activeKey], max: 2000 });
    console.error(e instanceof CheckError ? text : `live check crashed: ${text}`);
    process.exitCode = e instanceof CheckError ? e.exit : EXIT.setup;
  });
}
