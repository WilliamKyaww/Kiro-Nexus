// [[ completion logic (backlinks-completion, requirement 3): which part of a link the caret is
// in, what to suggest, and what to insert. Pure functions, so they are unit-tested.
import { noteTargetFor, resolveNoteTarget } from "@nexus/markdown";

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

/** Headings of the named note whose text holds the query, those starting with it first. */
export function headingSuggestions(query: string, headings: ReadonlyArray<{ text: string; slug: string; depth: number }>, limit = 12): Suggestion[] {
  const q = query.trim().toLowerCase();
  return headings
    .filter((h) => h.text && h.text.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.text.toLowerCase().startsWith(q)) - Number(!b.text.toLowerCase().startsWith(q)))
    .slice(0, limit)
    .map((h) => ({ id: `heading:${h.slug}`, kind: "heading", label: h.text, detail: null, value: h.text }));
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
