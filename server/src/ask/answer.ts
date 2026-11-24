// The final answer contract and its validation before rendering (PRD-052, PRD-053).
import { z } from "zod";
import type { Citation, HandleRegistry } from "./handles";

const Item = z.object({ text: z.string().min(1).max(2000), sources: z.array(z.string().max(20)).max(20).catch([]).default([]) });
export const RawAnswer = z.object({
  facts: z.array(Item).max(50).catch([]).default([]),
  discrepancies: z.array(Item).max(50).catch([]).default([]),
  suggestions: z.array(Item).max(50).catch([]).default([]),
  insufficientEvidence: z.boolean().catch(false).default(false),
  insufficientReason: z.string().max(1000).nullable().optional(),
});

const sources = { type: "array", items: { type: "string" } };
const item = { type: "object", properties: { text: { type: "string" }, sources }, required: ["text", "sources"], additionalProperties: false };
export const FINAL_ANSWER_SCHEMA = {
  type: "object",
  properties: {
    facts: { type: "array", items: item },
    discrepancies: { type: "array", items: item },
    suggestions: { type: "array", items: item },
    insufficientEvidence: { type: "boolean" },
    insufficientReason: { type: ["string", "null"] },
  },
  required: ["facts", "discrepancies", "suggestions", "insufficientEvidence", "insufficientReason"],
  additionalProperties: false,
};
export const FINAL_ANSWER_TOOL = {
  type: "function" as const,
  function: {
    name: "final_answer",
    description: "Give the answer. Facts must cite handles of sources you retrieved. Use suggestions for recommendations, and discrepancies when sources disagree.",
    parameters: FINAL_ANSWER_SCHEMA,
  },
};

export interface AnswerItem { text: string; sources: string[]; unsupported?: boolean; qualifier?: string }
export interface ValidatedAnswer {
  facts: AnswerItem[];
  discrepancies: AnswerItem[];
  suggestions: AnswerItem[];
  /** Claims that something does not exist, made without seeing every record. Shown with their qualifier. */
  unconfirmed: AnswerItem[];
  insufficientEvidence: boolean;
  insufficientReason: string | null;
  citations: Record<string, Citation>;
  /** How many cited handles were not sources of this run (invented) and were removed. */
  removedCitations: number;
  /** Facts or discrepancies moved to suggestions because no valid source remained. */
  demoted: number;
}

/**
 * Claims that no issue tracks something. This is a wording heuristic: it errs towards
 * qualifying, which is the safe direction, and only matters when coverage is incomplete.
 */
export const ABSENCE = /\b(no\b[^.]{0,30}\b(issue|ticket|task)s?\b|not (yet )?(been )?(tracked|covered|created|logged)|untracked|without (an? )?(matching |corresponding )?(issue|ticket)|lacks? (an? )?(issue|ticket)|missing (an? )?(issue|ticket)|nothing tracks|isn't tracked)/i;

export interface IssueCoverage { read: number; total: number; complete: boolean }

export function coverageQualifier(c: IssueCoverage): string {
  return c.read === 0
    ? "Not confirmed: Nexus did not read the issue records in this run, so a matching issue may exist."
    : `Not confirmed: Nexus read ${c.read} of ${c.total} issues in this run, so a matching issue may exist.`;
}

export function validateAnswer(raw: unknown, handles: HandleRegistry, coverage: IssueCoverage): ValidatedAnswer {
  const parsed = RawAnswer.safeParse(raw);
  const a = parsed.success ? parsed.data : { facts: [], discrepancies: [], suggestions: [], insufficientEvidence: true, insufficientReason: "The model's answer could not be read." };
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
  const facts: AnswerItem[] = [];
  const discrepancies: AnswerItem[] = [];
  const suggestions: AnswerItem[] = [];
  const unconfirmed: AnswerItem[] = [];
  // An absence claim is a recorded fact only if this run saw every issue record.
  const place = (list: AnswerItem[], item: AnswerItem) => {
    if (!coverage.complete && ABSENCE.test(item.text)) unconfirmed.push({ ...item, qualifier: coverageQualifier(coverage) });
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
    facts, discrepancies, suggestions, unconfirmed,
    insufficientEvidence: insufficient,
    insufficientReason: insufficient ? (a.insufficientReason ?? (facts.length === 0 ? "No statement could be supported by a cited source." : null)) : null,
    citations: Object.fromEntries(used),
    removedCitations: removed,
    demoted,
  };
}
