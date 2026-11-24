import { describe, expect, it } from "vitest";
import { CONTEXT_ANSWER_CHARS, CONTEXT_TOTAL_CHARS, CONTEXT_TURNS, contextBlock, priorTurns } from "./context";
import type { Message } from "./conversations";

const turn = (n: number, text = `Fact ${n}.`, status: Message["status"] = "complete"): Message[] => [
  { id: `u${n}`, role: "user", at: "", runId: `run${n}`, text: `Question number ${n}?`, status: "complete", answer: null, meta: null, error: null },
  {
    id: `a${n}`, role: "assistant", at: "", runId: `run${n}`, text: null, status, meta: null, error: null,
    answer: status !== "complete" ? null : {
      facts: [{ text, sources: ["S1", "S2"] }], discrepancies: [], suggestions: [{ text: "Create one.", sources: [] }], unconfirmed: [],
      insufficientEvidence: false, insufficientReason: null, removedCitations: 0, demoted: 0,
      citations: {
        S1: { handle: "S1", label: "Kickoff › Actions", target: { kind: "note", path: "k.md", headingSlug: "actions", headingText: "Actions" } },
        S2: { handle: "S2", label: "NEX-1 Build calendar view", target: { kind: "issue", key: "NEX-1" } },
      },
    },
  },
];

describe("conversation context", () => {
  it("pairs questions with answers, drops unanswered turns and replaces handles with labels", () => {
    const turns = priorTurns([...turn(1), ...turn(2, "x", "failed"), ...turn(3)]);
    expect(turns.map((t) => t.question)).toEqual(["Question number 1?", "Question number 3?"]);
    expect(turns[0]!.answer).toBe("Fact 1. [sources: Kickoff › Actions; NEX-1 Build calendar view] Suggestion: Create one.");
    expect(turns[0]!.answer).not.toMatch(/\bS\d\b/);
  });

  it("keeps only the last few turns and stays within its size limits", () => {
    const many = priorTurns(Array.from({ length: 10 }, (_, n) => turn(n + 1, "y".repeat(5000))).flat());
    const block = contextBlock(many)!;
    expect(block.turns).toBeLessThanOrEqual(CONTEXT_TURNS);
    expect(block.text.length).toBeLessThanOrEqual(CONTEXT_TOTAL_CHARS);
    expect(block.text).toContain("Question number 10?");
    expect(block.text).not.toContain("Question number 7?");
    expect(many[0]!.answer.length).toBeLessThanOrEqual(CONTEXT_ANSWER_CHARS);
    expect(contextBlock([])).toBeNull();
  });
});
