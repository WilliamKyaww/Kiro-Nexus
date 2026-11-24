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

export interface AnswerItem { text: string; sources: string[]; unsupported?: boolean }
export interface ValidatedAnswer {
  facts: AnswerItem[];
  discrepancies: AnswerItem[];
  suggestions: AnswerItem[];
  insufficientEvidence: boolean;
  insufficientReason: string | null;
  citations: Record<string, Citation>;
  /** How many cited handles were not sources of this run (invented) and were removed. */
  removedCitations: number;
  /** Facts or discrepancies moved to suggestions because no valid source remained. */
  demoted: number;
}

export function validateAnswer(raw: unknown, handles: HandleRegistry): ValidatedAnswer {
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
  for (const f of a.facts) {
    const s = clean(f.sources);
    if (s.length) facts.push({ text: f.text, sources: s });
    else { demoted += 1; suggestions.push({ text: f.text, sources: [], unsupported: true }); }
  }
  for (const d of a.discrepancies) {
    const s = clean(d.sources);
    if (s.length) discrepancies.push({ text: d.text, sources: s });
    else { demoted += 1; suggestions.push({ text: d.text, sources: [], unsupported: true }); }
  }
  for (const g of a.suggestions) suggestions.push({ text: g.text, sources: clean(g.sources) });
  const insufficient = a.insufficientEvidence || (facts.length === 0 && discrepancies.length === 0);
  return {
    facts, discrepancies, suggestions,
    insufficientEvidence: insufficient,
    insufficientReason: insufficient ? (a.insufficientReason ?? (facts.length === 0 ? "No statement could be supported by a cited source." : null)) : null,
    citations: Object.fromEntries(used),
    removedCitations: removed,
    demoted,
  };
}
