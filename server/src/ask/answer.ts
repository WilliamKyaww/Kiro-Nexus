// The final answer contract and its validation before rendering (PRD-052, PRD-053).
// Tracking claims are structured and checked against the evidence of the run
// (requirement 8), never against the wording of the claim.
import { z } from "zod";
import type { Citation, Evidence, HandleRegistry } from "./handles";

const Item = z.object({ text: z.string().min(1).max(2000), sources: z.array(z.string().max(20)).max(20).catch([]).default([]) });
const Tracking = z.object({
  action: z.string().min(1).max(500),
  source: z.string().max(20).catch(""),
  status: z.enum(["tracked", "untracked"]),
  issues: z.array(z.string().max(20)).max(20).catch([]).default([]),
  reason: z.string().max(1000).catch("").default(""),
});
export const RawAnswer = z.object({
  facts: z.array(Item).max(50).catch([]).default([]),
  discrepancies: z.array(Item).max(50).catch([]).default([]),
  suggestions: z.array(Item).max(50).catch([]).default([]),
  // Entries that do not parse are dropped one by one, not the whole list.
  tracking: z.array(z.unknown()).max(50).catch([]).default([]),
  insufficientEvidence: z.boolean().catch(false).default(false),
  insufficientReason: z.string().max(1000).nullable().optional(),
});

const sources = { type: "array", items: { type: "string" } };
const item = { type: "object", properties: { text: { type: "string" }, sources }, required: ["text", "sources"], additionalProperties: false };
const trackingItem = {
  type: "object",
  properties: {
    action: { type: "string", description: "The action as written in the note section." },
    source: { type: "string", description: "Handle of the note section the action comes from." },
    status: { type: "string", enum: ["tracked", "untracked"] },
    issues: { ...sources, description: "Handles of the issue records that track this action; empty when untracked." },
    reason: { type: "string", description: "Why this issue tracks the action, or why none does." },
  },
  required: ["action", "source", "status", "issues", "reason"],
  additionalProperties: false,
};
export const FINAL_ANSWER_SCHEMA = {
  type: "object",
  properties: {
    facts: { type: "array", items: item },
    discrepancies: { type: "array", items: item },
    suggestions: { type: "array", items: item },
    tracking: { type: "array", items: trackingItem, description: "One entry per action when the question is about what is tracked or missing; otherwise empty." },
    insufficientEvidence: { type: "boolean" },
    insufficientReason: { type: ["string", "null"] },
  },
  required: ["facts", "discrepancies", "suggestions", "tracking", "insufficientEvidence", "insufficientReason"],
  additionalProperties: false,
};
export const FINAL_ANSWER_TOOL = {
  type: "function" as const,
  function: {
    name: "final_answer",
    description: "Give the answer. Facts must cite handles of sources you retrieved. Put each action's tracking in tracking (not in facts). Use suggestions for recommendations, and discrepancies when sources disagree.",
    parameters: FINAL_ANSWER_SCHEMA,
  },
};

export interface AnswerItem { text: string; sources: string[]; unsupported?: boolean; qualifier?: string }
export interface TrackingEntry {
  action: string;
  source: string;
  status: "tracked" | "untracked";
  issues: string[];
  reason: string;
  /** True when the run's evidence supports the entry; otherwise it is shown under "Not confirmed". */
  confirmed: boolean;
  problem: string | null;
}
export interface ValidatedAnswer {
  facts: AnswerItem[];
  discrepancies: AnswerItem[];
  suggestions: AnswerItem[];
  /** Claims the run's evidence does not support. Shown with their qualifier. */
  unconfirmed: AnswerItem[];
  /** The structured tracking claims, each with whether the evidence confirmed it. */
  tracking: TrackingEntry[];
  insufficientEvidence: boolean;
  insufficientReason: string | null;
  citations: Record<string, Citation>;
  /** How many cited handles were not sources of this run (invented) and were removed. */
  removedCitations: number;
  /** Facts or discrepancies moved to suggestions because no valid source remained. */
  demoted: number;
}

export interface IssueCoverage { read: number; total: number; complete: boolean }

export function coverageQualifier(c: IssueCoverage): string {
  return c.read === 0
    ? `Not confirmed: Nexus did not read the issue records in this run, so a matching issue may exist.`
    : `Not confirmed: Nexus read ${c.read} of ${c.total} issues in this run, so a matching issue may exist.`;
}

const STATUS_TEXT: Record<string, string> = { todo: "to do", in_progress: "in progress", done: "done" };

/**
 * Content words for overlap checks: 4+ letters, with simple plural and tense endings and a
 * final "e" removed, so that "writes" and "Write" or "notes" and "note" compare equal.
 */
export function contentWords(text: string): Set<string> {
  const stem = (w: string) => w.replace(/(ings?|ed|es|s)$/, "").replace(/e$/, "");
  return new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).map(stem).filter((w) => w.length >= 3));
}

/**
 * How well an issue record matches an action (R4-4). Strong: most of the issue title's
 * content words are in the action (at least two, unless the title has only one). Weak: some
 * word of the title or description is shared, which alone does not show that the issue tracks
 * the action ("Book judge travel" against "Will writes the judge instructions").
 */
export function matchStrength(action: string, issue: { title: string; description: string }): { level: "strong" | "weak" | "none"; shared: string[] } {
  const a = contentWords(action);
  const title = contentWords(issue.title);
  const inTitle = [...title].filter((w) => a.has(w));
  if (title.size && inTitle.length >= Math.min(2, title.size) && inTitle.length / title.size >= 0.6) return { level: "strong", shared: inTitle };
  const shared = [...new Set([...title, ...contentWords(issue.description)])].filter((w) => a.has(w));
  return { level: shared.length ? "weak" : "none", shared };
}

/**
 * The words that identify an action, without its owner: in "Hein builds the calendar view"
 * the leading name is who does it, not what it is, and is often an ordinary word ("Will").
 */
export function actionWords(action: string): Set<string> {
  const tokens = action.trim().split(/\s+/);
  const owner = tokens.length >= 3 && /^[A-Z][a-z]+$/.test(tokens[0]!) && /^[a-z]+s$/.test(tokens[1]!) ? tokens[0]!.toLowerCase() : null;
  const words = contentWords(action);
  if (owner) words.delete(owner.replace(/(ings?|ed|es|s)$/, "").replace(/e$/, ""));
  return words;
}

/** Whether a statement is about an action: it shares a word that identifies the action. */
function isAbout(text: string, action: string): boolean {
  const have = contentWords(text);
  return [...actionWords(action)].some((w) => have.has(w));
}

/** The words of a text whose stems are in `stems`, as written, for a readable qualifier. */
function asWritten(text: string, stems: string[]): string[] {
  const out = new Set<string>();
  for (const w of text.match(/[A-Za-z0-9]{4,}/g) ?? []) if (contentWords(w).size && stems.includes([...contentWords(w)][0]!)) out.add(w.toLowerCase());
  return [...out];
}

/** A calendar date; `year` is null when the text gives none ("5 December"). */
export interface DateValue { year: number | null; month: number; day: number }
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, "gi");
const MONTH_DAY = new RegExp(`\\b${MONTH}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, "gi");

/** The calendar dates a text states: "2026-12-05", "5 December", "5 Dec 2026", "December 5th, 2026". */
export function datesIn(text: string): DateValue[] {
  const out: DateValue[] = [];
  const push = (year: number | null, month: number, day: number) => { if (month >= 1 && month <= 12 && day >= 1 && day <= 31) out.push({ year, month, day }); };
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(DAY_MONTH)) push(m[3] ? Number(m[3]) : null, month(m[2]!), Number(m[1]));
  for (const m of text.matchAll(MONTH_DAY)) push(m[3] ? Number(m[3]) : null, month(m[1]!), Number(m[2]));
  return out;
}

/** An issue status a text states, as Nexus shows it ("to do", "in progress", "done"); "not done" is negated. */
export interface StatusValue { status: "todo" | "in_progress" | "done"; negated: boolean }

/**
 * Ordinary status wording (R6-6). "Started" is in progress, and "not started" is to do;
 * "unfinished" and "incomplete" are negated "done". A ticked checkbox reads as done.
 */
const STATUS_FORMS: Array<{ form: RegExp; status: StatusValue["status"]; negative?: true; started?: true }> = [
  { form: /\bto[ -]?do\b/gi, status: "todo" },
  { form: /\bin[ _-]progress\b/gi, status: "in_progress" },
  { form: /\bunder[ -]?way\b/gi, status: "in_progress" },
  { form: /\bongoing\b/gi, status: "in_progress" },
  { form: /\b(?:started|begun)\b/gi, status: "in_progress", started: true },
  { form: /\b(?:done|finished|completed?|ticked)\b/gi, status: "done" },
  { form: /\b(?:unfinished|incomplete|unticked)\b/gi, status: "done", negative: true },
];
/** "not", "isn't", "never", "no longer", with the adverbs that may follow, just before a status. */
const NEGATION_BEFORE_STATUS = /(?:\b(?:not|never)|n['’]t|\bno longer)\s+(?:(?:yet|been|being|currently|actually|really|fully|even|ever|already|quite|still)\s+)*$/i;
/** A negation up to three words before a date ("not due on", "isn't due by"). */
const NEGATION_BEFORE_DATE = /(?:\b(?:not|never)|n['’]t|\bno longer)((?:\s+[a-z’']+){0,3})\s*$/i;

/** A value a clause states, and the span of text that states it, its negation included. */
interface Stated { start: number; end: number; negated: boolean }
export interface StatedValues { dates: Array<Stated & { date: DateValue }>; statuses: Array<Stated & { status: StatusValue["status"] }> }

/**
 * The due dates and statuses a clause states, with negation (R6-6). A negation belongs to the
 * value it comes just before, and never reaches back past an earlier value. "Not due until
 * 5 December" states 5 December.
 */
export function valuesIn(text: string): StatedValues {
  type Found = { start: number; end: number; date?: DateValue; status?: StatusValue["status"]; negative?: boolean; started?: boolean };
  const found: Found[] = [];
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const date = (m: RegExpMatchArray, year: number | null, mo: number, day: number) => {
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) found.push({ start: m.index!, end: m.index! + m[0].length, date: { year, month: mo, day } });
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) date(m, Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(DAY_MONTH)) date(m, m[3] ? Number(m[3]) : null, month(m[2]!), Number(m[1]));
  for (const m of text.matchAll(MONTH_DAY)) date(m, m[3] ? Number(m[3]) : null, month(m[1]!), Number(m[2]));
  for (const f of STATUS_FORMS) for (const m of text.matchAll(f.form)) found.push({ start: m.index!, end: m.index! + m[0].length, status: f.status, negative: f.negative, started: f.started });
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: StatedValues = { dates: [], statuses: [] };
  let prevEnd = 0;
  for (const v of found) {
    if (v.start < prevEnd) continue; // overlaps a value already read
    const window = text.slice(prevEnd, v.start);
    let start = v.start;
    if (v.date) {
      const n = window.match(NEGATION_BEFORE_DATE);
      if (n) start = prevEnd + n.index!;
      out.dates.push({ start, end: v.end, negated: !!n && !/\b(?:until|till)\b/i.test(n[1] ?? ""), date: v.date });
    } else {
      const n = window.match(NEGATION_BEFORE_STATUS);
      if (n) start = prevEnd + n.index!;
      const negated = !!n !== !!v.negative;
      // "Not started" is a status of its own: to do.
      if (v.started && negated) out.statuses.push({ start, end: v.end, negated: false, status: "todo" });
      else out.statuses.push({ start, end: v.end, negated, status: v.status! });
    }
    prevEnd = v.end;
  }
  return out;
}

export function statusesIn(text: string): StatusValue[] {
  return valuesIn(text).statuses.map(({ status, negated }) => ({ status, negated }));
}

/**
 * The clauses of a statement, each checked on its own (R6-6): its sentences, and within them
 * the parts joined by a semicolon or by "but", "and", "while", "whereas", "although", "though"
 * or "however". Text in quotation marks or brackets is never split.
 */
export function clausesOf(text: string): string[] {
  const masked = text.replace(/“[^”]*”|"[^"]*"|\([^)]*\)/g, (m) => "\u0001".repeat(m.length));
  const out: string[] = [];
  let from = 0;
  for (const m of masked.matchAll(/[.!?]+(?=\s+[A-Z“"‘(\u0001]|\s*$)|\s*;\s*|,?\s+(?:but|and|while|whereas|although|though|however)\b,?(?=\s)/g)) {
    out.push(text.slice(from, m.index));
    from = m.index! + m[0].length;
  }
  out.push(text.slice(from));
  return out.map((c) => c.trim()).filter((c) => c !== "");
}

/**
 * The words that may surround the values Nexus checks in a statement about an action whose
 * tracking it has checked (R6-6). Besides these, such a statement may use only the words of
 * the actions, and of the names of the sources it cites. Anything else ("no", "matching",
 * "untracked") is a claim Nexus cannot check, so the statement is not confirmed.
 */
const NEUTRAL_WORDS = new Set(`a an the this that these those it its their his her both which who whose
  is are was were be been being has have had does do did will would should can could may might must
  on in at by for of to from with as into under about per according
  and but while whereas although though however also so
  still already currently now yet
  due date dated deadline set scheduled planned expected
  issue record card task action item work ticket entry
  note marks marked lists listed shows says records recorded states
  section heading checklist checkbox meeting board project`.split(/\s+/).filter(Boolean));
/** Words never accepted in such a statement outside a checked value, even when an action's text or a source's name holds them. */
const NEVER_NEUTRAL = new Set(["no", "not", "none", "never", "nothing", "nobody", "neither", "nor", "without", "cannot", "untracked", "missing", "lack", "lacks", "lacking", "absent"]);
const wordsOf = (text: string) => text.toLowerCase().replace(/[’']s\b/g, "").match(/[a-z0-9]+(?:['’][a-z]+)*/g) ?? [];
/**
 * A test for a set of words: a word of four or more letters also matches by its stem ("marked",
 * "builds"); a shorter one only as written, so that "not" never passes as the stem of "note".
 */
function wordTest(words: Iterable<string>): (w: string) => boolean {
  const exact = new Set(words);
  const stems = new Set([...exact].filter((w) => w.length >= 4).map((w) => [...contentWords(w)][0] ?? w));
  return (w) => exact.has(w) || (w.length >= 4 && stems.has([...contentWords(w)][0] ?? w));
}
const isNeutral = wordTest(NEUTRAL_WORDS);
/** The words of a statement's clauses that are neither a value Nexus checks, a key, nor an allowed word. */
function uncheckedWords(clauses: string[], keys: string[], allowedText: string[]): string[] {
  const isAllowed = wordTest(allowedText.flatMap(wordsOf));
  const keyForm = keys.length ? new RegExp(`\\b(?:${keys.map((k) => k.replace(/[^A-Za-z0-9]/g, "\\$&")).join("|")})\\b`, "gi") : null;
  const out = new Set<string>();
  for (const clause of clauses) {
    const v = valuesIn(clause);
    let rest = clause;
    for (const s of [...v.dates, ...v.statuses]) rest = rest.slice(0, s.start) + " ".repeat(s.end - s.start) + rest.slice(s.end);
    if (keyForm) rest = rest.replace(keyForm, (m) => " ".repeat(m.length));
    for (const w of wordsOf(rest)) if (NEVER_NEUTRAL.has(w) || (!isNeutral(w) && !isAllowed(w))) out.add(w);
  }
  return [...out];
}

const sameDate = (a: DateValue, b: DateValue) => a.month === b.month && a.day === b.day && (a.year === null || b.year === null || a.year === b.year);
const formatDate = (d: DateValue) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(d.year ?? 2000, d.month - 1, d.day));

type IssueRecord = NonNullable<Evidence["issue"]>;
/** The local date of a due value (and, for a timed one, its UTC date, which a model may quote). */
function dueDates(due: IssueRecord["due"]): DateValue[] {
  if (!due) return [];
  if ("date" in due) {
    const [year, month, day] = due.date.split("-").map(Number);
    return [{ year: year!, month: month!, day: day! }];
  }
  const instant = new Date(due.dateTime);
  if (Number.isNaN(instant.getTime())) return [];
  const utc = { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() };
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: due.timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(instant).map((x) => [x.type, x.value]));
    return [{ year: Number(p.year), month: Number(p.month), day: Number(p.day) }, utc];
  } catch {
    return [utc];
  }
}
/** How the run read a record, for a qualifier: "NEX-1 (Build calendar view) is in progress and due on 5 December 2026". */
function asRead(r: IssueRecord): string {
  const date = dueDates(r.due)[0];
  const due = r.due === undefined ? "" : r.due === null ? " and has no due date" : date ? ` and due on ${formatDate(date)}` : "";
  return `${r.key} (${r.title}) is ${STATUS_TEXT[r.status] ?? r.status}${due}`;
}

/** Most of the action's words appear on one line of the section the run read. */
function actionInSection(action: string, sectionText: string): boolean {
  const want = contentWords(action);
  if (want.size === 0) return sectionText.toLowerCase().includes(action.toLowerCase().trim());
  return sectionText.split(/\r?\n/).some((line) => {
    const have = contentWords(line);
    const hits = [...want].filter((w) => have.has(w)).length;
    return hits / want.size >= 0.8;
  });
}

export function validateAnswer(raw: unknown, handles: HandleRegistry, coverage: IssueCoverage): ValidatedAnswer {
  const parsed = RawAnswer.safeParse(raw);
  const a = parsed.success ? parsed.data : { facts: [], discrepancies: [], suggestions: [], tracking: [], insufficientEvidence: true, insufficientReason: "The model's answer could not be read." };
  let removed = 0;
  let demoted = 0;
  const used = new Map<string, Citation>();
  const clean = (srcs: string[]) => {
    const kept: string[] = [];
    for (const s of srcs) {
      const c = handles.get(s);
      if (!c) { removed += 1; continue; }
      if (!kept.includes(c.handle)) kept.push(c.handle);
      used.set(c.handle, c);
    }
    return kept;
  };
  const isIssue = (h: string) => handles.get(h)?.target.kind === "issue";
  const hasTasks = (h: string) => (handles.evidenceOf(h)?.tasks?.length ?? 0) > 0;

  const facts: AnswerItem[] = [];
  const discrepancies: AnswerItem[] = [];
  const suggestions: AnswerItem[] = [];
  const unconfirmed: AnswerItem[] = [];
  const tracking: TrackingEntry[] = [];

  // 1. Structured tracking claims, checked against what the run retrieved.
  for (const rawEntry of a.tracking) {
    const p = Tracking.safeParse(rawEntry);
    if (!p.success) continue;
    const t = p.data;
    const sourceHandles = clean(t.source ? [t.source] : []);
    const note = sourceHandles.find((h) => handles.get(h)?.target.kind === "note");
    const issueHandles = clean(t.issues).filter(isIssue);
    let problem: string | null = null;
    const sectionText = note ? handles.evidenceOf(note)?.sectionText : undefined;
    if (!note || sectionText === undefined) problem = "Not confirmed: the action does not cite a note section that Nexus read in this run.";
    else if (!actionInSection(t.action, sectionText)) problem = "Not confirmed: Nexus could not find this action in the cited section.";
    else if (t.status === "tracked") {
      if (issueHandles.length === 0) problem = "Not confirmed: no issue record from this run was cited.";
      else {
        // Every cited issue needs strong positive evidence (R4-4).
        for (const h of issueHandles) {
          const rec = handles.evidenceOf(h)?.issue;
          const m = matchStrength(t.action, { title: rec?.title ?? "", description: rec?.description ?? "" });
          const name = rec ? `${rec.key} (${rec.title})` : h;
          if (m.level === "none") { problem = `Not confirmed: ${name} shares no words with this action, and a link to the same heading does not show which action an issue tracks.`; break; }
          if (m.level === "weak") { problem = `Not confirmed: ${name} shares only “${asWritten(`${rec?.title ?? ""} ${rec?.description ?? ""}`, m.shared).join("”, “")}” with this action, which does not show that it tracks it.`; break; }
        }
      }
    } else if (!coverage.complete) problem = coverageQualifier(coverage);
    else {
      // An absence claim must not contradict a record the run read (R4-4).
      const records = handles.all().filter((c) => c.target.kind === "issue").map((c) => handles.evidenceOf(c.handle)?.issue).filter((r): r is NonNullable<typeof r> => !!r);
      const matches = records.map((r) => ({ r, m: matchStrength(t.action, r) }));
      const strong = matches.find((x) => x.m.level === "strong");
      const weak = matches.find((x) => x.m.level === "weak");
      if (strong) problem = `Not confirmed: ${strong.r.key} (${strong.r.title}) appears to match this action.`;
      else if (weak) problem = `Not confirmed: ${weak.r.key} (${weak.r.title}) may match this action (it shares “${asWritten(`${weak.r.title} ${weak.r.description}`, weak.m.shared).join("”, “")}”).`;
    }

    const entry: TrackingEntry = { action: t.action, source: note ?? "", status: t.status, issues: t.status === "tracked" ? issueHandles : [], reason: t.reason, confirmed: problem === null, problem };
    tracking.push(entry);
    const itemSources = [...(note ? [note] : []), ...entry.issues];
    const text = t.status === "tracked"
      ? `“${t.action}” is tracked by ${entry.issues.map((h) => {
        const rec = handles.evidenceOf(h)?.issue;
        return rec ? `${rec.key} (${rec.title}, ${STATUS_TEXT[rec.status] ?? rec.status})` : (handles.get(h)?.label ?? h);
      }).join(" and ") || "an issue"}.`
      : `“${t.action}” has no matching issue.`;
    if (problem === null) facts.push({ text, sources: itemSources });
    else unconfirmed.push({ text, sources: itemSources, qualifier: problem });
  }

  // 2. Free-text facts and discrepancies.
  // a. One that cites an issue record is checked against the fields the run read (R5-3), clause
  //    by clause (R6-6): each date or status a clause states, negated or not, must agree with a
  //    cited source. A date may be the record's due date or appear in a cited note section; a
  //    status may be the record's, or the checkbox of an action the clause is about in a cited
  //    section (the note's side of a discrepancy). A clause's values are compared with the
  //    record it names, else the one it names by title, else the previous clause's, else every
  //    record cited.
  // b. When the answer gives tracking entries, they are the checked statement about each action
  //    (R4-4). A statement about one of those actions, or citing or naming the issue Nexus
  //    confirmed tracks one, is recorded only as an ordinary statement about that issue: it
  //    cites the issue, states one of its values as the record has it (for example its due
  //    date, or a status mismatch with the note), and says nothing else that Nexus cannot check
  //    (R6-6). One correct value cannot carry a denial of the tracking result in another clause.
  // c. With issue coverage incomplete, one that rests on a section of actions but cites no issue
  //    record cannot be confirmed (a structural rule).
  const tracked = tracking.map((t) => ({ action: t.action, confirmedIssues: t.confirmed && t.status === "tracked" ? t.issues : [] }));
  const keyForm = (key: string) => new RegExp(`\\b${key.replace(/[^A-Za-z0-9]/g, "\\$&")}\\b`, "i");
  const names = (text: string, h: string) => { const rec = handles.evidenceOf(h)?.issue; return !!rec && keyForm(rec.key).test(text); };
  const aboutTracked = (item: AnswerItem) => tracked.filter((t) => isAbout(item.text, t.action) || t.confirmedIssues.some((h) => item.sources.includes(h) || names(item.text, h)));
  const citedRecords = (item: AnswerItem) => item.sources.flatMap((h) => { const rec = handles.evidenceOf(h)?.issue; return rec ? [{ h, rec }] : []; });
  const trackingQualifier = (item: AnswerItem) => {
    const records = citedRecords(item).map((x) => asRead(x.rec));
    return records.length
      ? `Not confirmed: Nexus checks whether an action is tracked only through its own sentences above, and the record${records.length === 1 ? "" : "s"} it read say${records.length === 1 ? "s" : ""} ${records.join("; ")}.`
      : "Not confirmed: Nexus checks whether an action is tracked only through its own sentences above, not through the model's wording.";
  };
  /** Which cited issue records agree with a stated value, and a qualifier if a value agrees with no cited source. */
  const checkValues = (item: AnswerItem): { agrees: Set<string>; problem: string | null } => {
    const agrees = new Set<string>();
    const cited = citedRecords(item);
    if (cited.length === 0) return { agrees, problem: null };
    const notes = item.sources.filter((h) => handles.get(h)?.target.kind === "note");
    const noteDates = notes.flatMap((h) => {
      const c = handles.get(h)!;
      return datesIn(`${c.target.kind === "note" ? c.target.path : ""} ${c.label} ${handles.evidenceOf(h)?.sectionText ?? ""}`);
    });
    const noteTasks = notes.flatMap((h) => handles.evidenceOf(h)?.tasks ?? []);
    const wrongAbout = new Set<(typeof cited)[number]>();
    const wrongTasks = new Set<{ text: string; done: boolean }>();
    let previous: typeof cited | null = null;
    for (const clause of clausesOf(item.text)) {
      const { dates, statuses } = valuesIn(clause);
      const named = cited.filter((x) => keyForm(x.rec.key).test(clause));
      const titled = cited.filter((x) => matchStrength(clause, { title: x.rec.title, description: "" }).level === "strong");
      const own = named.length ? named : titled.length ? titled : null;
      const about = own ?? previous ?? cited;
      if (own) previous = own;
      if (dates.length === 0 && statuses.length === 0) continue;
      const tasks = noteTasks.filter((t) => isAbout(clause, t.text));
      // `agrees` counts only a value that pins a field down: the due date, or the status itself.
      // "Not done" fits two statuses, "not due on 3 December" fits every other date, and a date
      // in a description is not the due date, so none of them shows that the statement is
      // about the record's values. A negated value that the record holds contradicts it.
      let wrong = false;
      for (const d of dates) {
        const due = about.filter((x) => dueDates(x.rec.due).some((a) => sameDate(d.date, a)));
        if (d.negated) { if (due.length) wrong = true; continue; }
        due.forEach((x) => agrees.add(x.h));
        const elsewhere = about.some((x) => datesIn(`${x.rec.title} ${x.rec.description}`).some((a) => sameDate(d.date, a))) || noteDates.some((a) => sameDate(d.date, a));
        if (due.length === 0 && !elsewhere) wrong = true;
      }
      for (const s of statuses) {
        const hits = about.filter((x) => (x.rec.status === s.status) !== s.negated);
        if (!s.negated) hits.forEach((x) => agrees.add(x.h));
        // A ticked checkbox reads as "done"; an unticked one as anything but "done".
        const inNote = tasks.some((t) => t.done ? (s.status === "done") !== s.negated : !(s.status === "done" && !s.negated));
        if (hits.length === 0 && !inNote) wrong = true;
      }
      if (wrong) { about.forEach((x) => wrongAbout.add(x)); tasks.forEach((t) => wrongTasks.add(t)); }
    }
    if (wrongAbout.size === 0) return { agrees, problem: null };
    const about = [...wrongAbout];
    const records = about.map((x) => asRead(x.rec)).join("; ");
    const marks = [...wrongTasks].map((t) => `“${t.text}” as ${t.done ? "done" : "not done"}`).join(" and ");
    return { agrees, problem: `Not confirmed: the record${about.length === 1 ? "" : "s"} Nexus read say${about.length === 1 ? "s" : ""} ${records}${marks ? `, and the note marks ${marks}` : ""}.` };
  };
  /** The words a statement may use besides the values Nexus checks: the actions, and the names of the sources it cites. */
  const allowedText = (item: AnswerItem) => [
    ...tracking.map((t) => t.action),
    ...item.sources.flatMap((h) => {
      const c = handles.get(h);
      if (!c) return [];
      return c.target.kind === "note" ? [c.label, c.target.path, c.target.headingText ?? ""] : [c.label, handles.evidenceOf(h)?.issue?.title ?? ""];
    }),
  ];
  const place = (list: AnswerItem[], item: AnswerItem) => {
    const values = checkValues(item);
    if (values.problem) { unconfirmed.push({ ...item, qualifier: values.problem }); return; }
    // Only statements that cite what a tracking claim rests on (a section of actions, or an
    // issue record) can restate one.
    const actions = item.sources.some(hasTasks) || item.sources.some(isIssue) ? aboutTracked(item) : [];
    if (actions.length && !actions.every((t) => t.confirmedIssues.some((h) => item.sources.includes(h) && values.agrees.has(h)))) {
      unconfirmed.push({ ...item, qualifier: trackingQualifier(item) });
      return;
    }
    if (actions.length) {
      const keys = citedRecords(item).map((x) => x.rec.key);
      if (uncheckedWords(clausesOf(item.text), keys, allowedText(item)).length) {
        unconfirmed.push({ ...item, qualifier: trackingQualifier(item) });
        return;
      }
    }
    const aboutActions = item.sources.some(hasTasks) && !item.sources.some(isIssue);
    if (!coverage.complete && aboutActions) unconfirmed.push({ ...item, qualifier: coverageQualifier(coverage) });
    else list.push(item);
  };
  for (const f of a.facts) {
    const s = clean(f.sources);
    if (s.length) place(facts, { text: f.text, sources: s });
    else { demoted += 1; suggestions.push({ text: f.text, sources: [], unsupported: true }); }
  }
  for (const d of a.discrepancies) {
    const s = clean(d.sources);
    if (s.length) place(discrepancies, { text: d.text, sources: s });
    else { demoted += 1; suggestions.push({ text: d.text, sources: [], unsupported: true }); }
  }
  for (const g of a.suggestions) suggestions.push({ text: g.text, sources: clean(g.sources) });
  const insufficient = a.insufficientEvidence || (facts.length === 0 && discrepancies.length === 0 && unconfirmed.length === 0);
  return {
    facts, discrepancies, suggestions, unconfirmed, tracking,
    insufficientEvidence: insufficient,
    insufficientReason: insufficient ? (a.insufficientReason ?? (facts.length === 0 ? "No statement could be supported by a cited source." : null)) : null,
    citations: Object.fromEntries(used),
    removedCitations: removed,
    demoted,
  };
}
