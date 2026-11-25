// [[ completion logic (backlinks-completion, requirement 3): which part of a link the caret is
// in, what to suggest, and what to insert. Pure functions, so they are unit-tested.
import { inCodeAt, noteTargetFor, plainHeadingText, resolveNoteTarget, sections, slugOf } from "@nexus/markdown";

export interface LinkToken {
  /** Index of the opening [[. */
  start: number;
  part: "target" | "heading" | "alias";
  /** The edited part's text from its start to the caret. */
  query: string;
  /** The link's target as written so far. */
  target: string;
  /** The edited part: [partStart, partEnd) is replaced on insertion. */
  partStart: number;
  partEnd: number;
  /** Whether ]] already follows on the same line. */
  closed: boolean;
}

/** The link the caret is in: an open [[ earlier on its line, not yet closed before the caret. */
export function linkAt(text: string, caret: number): LinkToken | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const before = text.slice(lineStart, caret);
  const open = before.lastIndexOf("[[");
  if (open < 0) return null;
  const typed = before.slice(open + 2);
  if (typed.includes("]") || typed.includes("[")) return null;
  const start = lineStart + open;
  const nl = text.indexOf("\n", caret);
  const rest = text.slice(caret, nl < 0 ? text.length : nl);
  const close = rest.indexOf("]]");
  const reopen = rest.indexOf("[[");
  const closed = close >= 0 && (reopen < 0 || close < reopen) && !rest.slice(0, close).includes("\n");
  const bodyStart = start + 2;
  const bodyEnd = closed ? caret + close : caret;
  const body = text.slice(bodyStart, bodyEnd);
  const at = caret - bodyStart;
  const hash = body.indexOf("#");
  const pipe = body.indexOf("|");
  const targetEnd = Math.min(...[hash, pipe, body.length].filter((i) => i >= 0));
  const target = body.slice(0, targetEnd).trim();
  if (pipe >= 0 && at > pipe) {
    return { start, part: "alias", query: body.slice(pipe + 1, at), target, partStart: bodyStart + pipe + 1, partEnd: bodyEnd, closed };
  }
  if (hash >= 0 && (pipe < 0 || hash < pipe) && at > hash) {
    const end = pipe >= 0 ? pipe : body.length;
    return { start, part: "heading", query: body.slice(hash + 1, at), target, partStart: bodyStart + hash + 1, partEnd: bodyStart + end, closed };
  }
  return { start, part: "target", query: body.slice(0, at), target, partStart: bodyStart, partEnd: bodyStart + targetEnd, closed };
}

/** The link the caret is in, where the preview would render a link: not in code (R6-16). */
export function completableLinkAt(text: string, caret: number): LinkToken | null {
  const token = linkAt(text, caret);
  return token && !inCodeAt(text, token.start) ? token : null;
}

export interface Suggestion { id: string; kind: "note" | "heading"; label: string; detail: string | null; value: string }

const stem = (p: string) => p.replace(/\.md$/i, "");
const nameOf = (p: string) => stem(p).split("/").pop() ?? p;
const folderOf = (p: string) => stem(p).split("/").slice(0, -1).join("/");

/** Notes for a target part: name starts with the query, then contains it, then the path does. */
export function noteSuggestions(query: string, notes: readonly string[], limit = 8): Suggestion[] {
  const q = query.trim().toLowerCase();
  const ranked = notes.flatMap((p) => {
    const name = nameOf(p).toLowerCase();
    const rank = !q || name.startsWith(q) ? 0 : name.includes(q) ? 1 : stem(p).toLowerCase().includes(q) ? 2 : -1;
    return rank < 0 ? [] : [{ p, rank }];
  });
  ranked.sort((a, b) => a.rank - b.rank || nameOf(a.p).localeCompare(nameOf(b.p)) || a.p.localeCompare(b.p));
  return ranked.slice(0, limit).map(({ p }) => ({ id: `note:${p}`, kind: "note", label: nameOf(p), detail: folderOf(p) || null, value: noteTargetFor(p, notes) }));
}

type HeadingLike = { text: string; slug: string; depth: number };

/**
 * What to write after # for a heading (R6-14). The preview follows slugOf(written) and the
 * backlinks try that slug first, so the heading's text is written only when it slugs to this
 * heading and fits in a link; otherwise its own slug (`tasks-1`), which always does.
 */
export function headingTargetFor(h: HeadingLike): string {
  return !/[[\]|\n]/.test(h.text) && slugOf(h.text) === h.slug ? h.text : h.slug;
}

/** The first line of each heading's section, as plain words, for telling repeated headings apart. */
function firstLines(content: string): Map<string, string> {
  return new Map(sections(content).flatMap((s) => {
    const line = s.text.split("\n").map((l) => plainHeadingText(l.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, ""))).find(Boolean);
    return s.headingSlug && line ? [[s.headingSlug, line] as const] : [];
  }));
}
const clip = (s: string, max = 36) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).trimEnd()}…`;
};

/**
 * How each repeated heading is told apart on screen: the heading it is under, when that differs;
 * otherwise the first line of its section; otherwise its position among them.
 */
function repeatedDetails(headings: readonly HeadingLike[], content: string): Map<string, string> {
  const parents = new Map<string, string | null>();
  const stack: HeadingLike[] = [];
  for (const h of headings) {
    while (stack.length && stack[stack.length - 1]!.depth >= h.depth) stack.pop();
    parents.set(h.slug, stack[stack.length - 1]?.text ?? null);
    stack.push(h);
  }
  const first = firstLines(content);
  const out = new Map<string, string>();
  const groups = new Map<string, HeadingLike[]>();
  for (const h of headings) groups.set(h.text, [...(groups.get(h.text) ?? []), h]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const unique = (value: (h: HeadingLike) => string | null | undefined, h: HeadingLike) => { const v = value(h); return v ? group.filter((g) => value(g) === v).length === 1 : false; };
    group.forEach((h, i) => {
      if (unique((x) => parents.get(x.slug), h)) out.set(h.slug, `under ${parents.get(h.slug)!}`);
      else if (unique((x) => first.get(x.slug), h)) out.set(h.slug, `“${clip(first.get(h.slug)!)}”`);
      else out.set(h.slug, `${i + 1} of ${group.length}`);
    });
  }
  return out;
}

/**
 * Headings of the named note whose text holds the query (or whose slug starts with it), those
 * starting with it first. Repeated headings say which is which, and each inserts a target that
 * opens that heading (R6-14).
 */
export function headingSuggestions(query: string, headings: ReadonlyArray<HeadingLike>, content = "", limit = 12): Suggestion[] {
  const q = query.trim().toLowerCase();
  const details = repeatedDetails(headings, content);
  return headings
    .filter((h) => h.text && (h.text.toLowerCase().includes(q) || (!!q && h.slug.startsWith(q))))
    .sort((a, b) => Number(!a.text.toLowerCase().startsWith(q)) - Number(!b.text.toLowerCase().startsWith(q)))
    .slice(0, limit)
    .map((h) => ({ id: `heading:${h.slug}`, kind: "heading", label: h.text, detail: details.get(h.slug) ?? null, value: headingTargetFor(h) }));
}

/** What to say instead of offering a guess (requirement 3.5). */
export function headingNoteProblem(token: LinkToken, notes: readonly string[], from: string | null): { path: string } | { message: string } {
  if (!token.target) return { message: "Write the note's name before #." };
  const r = resolveNoteTarget(token.target, notes, from);
  if (r.status === "ok") return { path: r.path };
  if (r.status === "missing") return { message: `No note is called “${token.target}”.` };
  return { message: `Several notes are called “${token.target}”: ${r.candidates.map(stem).join(", ")}. Write the folder first, for example ${stem(r.candidates[0]!)}.` };
}

/** The edit that inserts a suggestion: only the edited part changes, and an unclosed link is closed. */
export function completion(token: LinkToken, value: string): { from: number; to: number; insert: string; caret: number } {
  const insert = token.closed ? value : `${value}]]`;
  return { from: token.partStart, to: token.partEnd, insert, caret: token.partStart + insert.length };
}
