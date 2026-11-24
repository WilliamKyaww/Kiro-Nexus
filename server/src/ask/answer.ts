// The final answer contract and its validation before rendering (PRD-052, PRD-053).
// Tracking claims are structured and checked against the evidence of the run
// (requirement 8), never against the wording of the claim.
import { z } from "zod";
import type { Citation, HandleRegistry } from "./handles";

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

/** Content words for overlap checks: 4+ letters, with simple plural and tense endings removed. */
export function contentWords(text: string): Set<string> {
  const stem = (w: string) => w.replace(/(ings?|ed|es|s)$/, "");
  return new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).map(stem).filter((w) => w.length >= 3));
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
        const words = contentWords(t.action);
        const unrelated = issueHandles.filter((h) => {
          const rec = handles.evidenceOf(h)?.issue;
          const have = contentWords(`${rec?.title ?? ""} ${rec?.description ?? ""}`);
          return ![...words].some((w) => have.has(w));
        });
        if (unrelated.length) {
          const keys = unrelated.map((h) => handles.evidenceOf(h)?.issue?.key ?? h).join(", ");
          problem = `Not confirmed: ${keys} shares no words with this action, and a link to the same heading does not show which action an issue tracks.`;
        }
      }
    } else if (!coverage.complete) problem = coverageQualifier(coverage);

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

  // 2. Free-text facts and discrepancies. With issue coverage incomplete, one that rests on
  // a section of actions but cites no issue record cannot be confirmed (a structural rule).
  const place = (list: AnswerItem[], item: AnswerItem) => {
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
