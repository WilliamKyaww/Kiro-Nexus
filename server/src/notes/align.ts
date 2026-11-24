// Document-wide heading identity between two versions of one note (run-5 repair R4-8):
// usually its accepted text and its text on disk while an edit awaits review, or the text
// before and after a review decision. Slugs are computed over the whole document on each
// side, so a heading renamed to the name of another one, or a heading added or removed in
// the same edit, still maps to the right section.
import { parseHeadings, type Heading } from "@nexus/markdown";

const toLines = (s: string) => s.replace(/\r\n/g, "\n").split("\n");
/** Beyond this many differing lines, fall back to matching by position (notes are small). */
const MAX_DIFF_CELLS = 4_000_000;

/** Pairs of matching line indices (a in `from`, b in `to`), in order: a longest common subsequence. */
function matchLines(from: string[], to: string[]): Array<[number, number]> {
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head++;
  let tail = 0;
  while (tail < from.length - head && tail < to.length - head && from[from.length - 1 - tail] === to[to.length - 1 - tail]) tail++;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < head; i++) pairs.push([i, i]);
  const a = from.slice(head, from.length - tail);
  const b = to.slice(head, to.length - tail);
  if (a.length && b.length && a.length * b.length <= MAX_DIFF_CELLS) {
    // Classic dynamic-programming LCS over the differing middle.
    const w = b.length + 1;
    const dp = new Uint32Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { pairs.push([head + i, head + j]); i++; j++; }
      else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
      else j++;
    }
  }
  for (let k = tail; k > 0; k--) pairs.push([from.length - k, to.length - k]);
  return pairs;
}

export interface HeadingMap {
  /** Slug in `from` → slug in `to`, for every heading that exists in both versions. */
  forward: Map<string, string>;
  /** Slug in `to` → slug in `from`. */
  backward: Map<string, string>;
  /** Headings of `to`, for the text of a mapped slug. */
  toHeadings: Heading[];
}

/**
 * Which heading of `to` each heading of `from` became. A heading on an unchanged line keeps
 * its identity. A changed heading line follows its section's body (the lines under it that
 * are unchanged). Anything left is paired by position between the same unchanged lines.
 */
export function alignHeadings(from: string, to: string): HeadingMap {
  const A = toLines(from);
  const B = toLines(to);
  const hA = parseHeadings(from);
  const hB = parseHeadings(to);
  const pairs = matchLines(A, B);
  const aToB = new Map(pairs);
  const lineOfB = new Map(hB.map((h, i) => [h.line, i]));
  const pairedA = new Map<number, number>();
  const pairedB = new Set<number>();
  const pair = (ia: number, ib: number) => { pairedA.set(ia, ib); pairedB.add(ib); };

  // 1. Unchanged heading lines.
  hA.forEach((h, ia) => {
    const lb = aToB.get(h.line);
    const ib = lb === undefined ? undefined : lineOfB.get(lb);
    if (ib !== undefined && !pairedB.has(ib)) pair(ia, ib);
  });
  // 2. A changed heading follows the unchanged lines of its own section body.
  const sectionOfB = (line: number) => { let s = -1; hB.forEach((h, i) => { if (h.line <= line) s = i; }); return s; };
  hA.forEach((h, ia) => {
    if (pairedA.has(ia)) return;
    const end = hA[ia + 1]?.line ?? A.length;
    const votes = new Map<number, number>();
    for (let l = h.line + 1; l < end; l++) {
      const lb = aToB.get(l);
      if (lb === undefined || (A[l] ?? "").trim() === "") continue;
      const s = sectionOfB(lb);
      if (s >= 0) votes.set(s, (votes.get(s) ?? 0) + 1);
    }
    const best = [...votes.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best && !pairedB.has(best[0])) pair(ia, best[0]);
  });
  // 3. What is left, by position between the same unchanged lines.
  const anchorBefore = (line: number) => { let best: [number, number] | null = null; for (const p of pairs) if (p[0] < line) best = p; return best; };
  const gapOfA = (line: number) => anchorBefore(line)?.[1] ?? -1;
  const gapOfB = (line: number) => { let best = -1; for (const p of pairs) if (p[1] < line) best = p[1]; return best; };
  const leftA = hA.map((h, i) => ({ h, i })).filter((x) => !pairedA.has(x.i));
  const leftB = hB.map((h, i) => ({ h, i })).filter((x) => !pairedB.has(x.i));
  for (const a of leftA) {
    const gap = gapOfA(a.h.line);
    const b = leftB.find((x) => !pairedB.has(x.i) && gapOfB(x.h.line) === gap);
    if (b) pair(a.i, b.i);
  }

  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  for (const [ia, ib] of pairedA) {
    forward.set(hA[ia]!.slug, hB[ib]!.slug);
    backward.set(hB[ib]!.slug, hA[ia]!.slug);
  }
  return { forward, backward, toHeadings: hB };
}

/** Slugs that change between two versions: what a saved link to `from` must follow. */
export function slugMoves(from: string, to: string): Array<{ from: string; to: string; toText: string }> {
  const map = alignHeadings(from, to);
  const textOf = new Map(map.toHeadings.map((h) => [h.slug, h.text]));
  return [...map.forward.entries()].filter(([f, t]) => f !== t).map(([f, t]) => ({ from: f, to: t, toText: textOf.get(t) ?? t }));
}
