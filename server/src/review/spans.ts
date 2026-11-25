// Pure, line-aligned span logic for note changes (architecture 7.4, DEC-012).
// Content is handled as LF internally; CRLF files are written back as CRLF.
import { parseHeadings } from "@nexus/markdown";

export interface Located { status: "ok"; start: number; length: number }
export type LocateResult = Located | { status: "missing" } | { status: "ambiguous"; count: number };
export interface SpanContext { lineBefore: string | null; lineAfter: string | null }

const usesCrlf = (content: string) => content.includes("\r\n");
const toLf = (s: string) => s.replace(/\r\n/g, "\n");

export function docLines(content: string): string[] {
  return toLf(content).split("\n");
}

/** Span text as whole lines (a single trailing newline is optional). */
export function spanLines(text: string): string[] {
  const lf = toLf(text);
  if (lf === "") return [];
  return (lf.endsWith("\n") ? lf.slice(0, -1) : lf).split("\n");
}

export function occurrences(lines: string[], span: string[]): number[] {
  const out: number[] = [];
  if (span.length === 0) return out;
  for (let i = 0; i + span.length <= lines.length; i++) {
    let match = true;
    for (let k = 0; k < span.length; k++) {
      if (lines[i + k] !== span[k]) { match = false; break; }
    }
    if (match) out.push(i);
  }
  return out;
}

export function contextAt(lines: string[], start: number, length: number): SpanContext {
  let lineBefore: string | null = null;
  for (let j = start - 1; j >= 0; j--) if ((lines[j] ?? "").trim() !== "") { lineBefore = lines[j] ?? null; break; }
  let lineAfter: string | null = null;
  for (let j = start + length; j < lines.length; j++) if ((lines[j] ?? "").trim() !== "") { lineAfter = lines[j] ?? null; break; }
  return { lineBefore, lineAfter };
}

/**
 * Find `text` in `content`; neighbouring lines disambiguate repeats. Never guesses.
 *
 * With a saved `context`, even a sole occurrence must keep at least one of its saved
 * neighbouring lines: the same text elsewhere in the note, with both neighbours different, is
 * not the span the change wrote (R5-1). That case is reported as `missing`, so a reversal
 * becomes a conflict instead of rewriting another paragraph.
 */
export function locate(content: string, text: string, context: SpanContext | null): LocateResult {
  const lines = docLines(content);
  const span = spanLines(text);
  const found = occurrences(lines, span);
  if (found.length === 0) return { status: "missing" };
  if (found.length === 1) {
    if (!context) return { status: "ok", start: found[0]!, length: span.length };
    const c = contextAt(lines, found[0]!, span.length);
    if (c.lineBefore === context.lineBefore || c.lineAfter === context.lineAfter) return { status: "ok", start: found[0]!, length: span.length };
    return { status: "missing" };
  }
  if (context) {
    const matching = found.filter((i) => {
      const c = contextAt(lines, i, span.length);
      return c.lineBefore === context.lineBefore && c.lineAfter === context.lineAfter;
    });
    if (matching.length === 1) return { status: "ok", start: matching[0]!, length: span.length };
  }
  return { status: "ambiguous", count: found.length };
}

/** What identifies a note change in the current text: its lines, its neighbours and its section. */
export interface NoteChangeIdentity {
  before: unknown;
  after: unknown;
  context: SpanContext | null;
  /** The section on disk the change was proposed in (an Edit run's scope); absent for the fixed demo and older journals. */
  scope?: { headingSlug: string | null } | null;
}

/**
 * Where a note change belongs in the current text (R6-1):
 * - `note`: it has no recorded scope (the fixed demo, older journals), so the whole note, with
 *   the run-5 rules of `locate`;
 * - `section`: its recorded section, found by its heading slug (mapped through later recorded
 *   heading moves). Only lines that start in that section can be the change;
 * - `unknown`: it has a scope, but its section can no longer be told: the heading is gone, or the
 *   change itself rewrites a heading line. The whole note, with stricter rules.
 */
export type ChangeSection = { kind: "note" } | { kind: "section"; range: LineRange } | { kind: "unknown" };

const startsWithHeading = (text: unknown) => {
  const first = spanLines(String(text ?? ""))[0];
  return first !== undefined && parseHeadings(first).length > 0;
};

export function changeSection(content: string, change: NoteChangeIdentity, mapSlug: (slug: string) => string = (s) => s): ChangeSection {
  if (!change.scope) return { kind: "note" };
  if (startsWithHeading(change.after) || startsWithHeading(change.before)) return { kind: "unknown" };
  const lines = docLines(content);
  if (change.scope.headingSlug === null) return { kind: "section", range: { start: 0, end: lines.length } };
  const slug = mapSlug(change.scope.headingSlug);
  const headings = parseHeadings(content);
  const i = headings.findIndex((h) => h.slug === slug);
  if (i < 0) return { kind: "unknown" };
  return { kind: "section", range: { start: headings[i]!.line, end: headings[i + 1]?.line ?? lines.length } };
}

/**
 * Find the lines a note change wrote (its `after` text) in `content`, by the same rules for
 * reversal, the accepted text, the review bar and overlap checks. Never guesses (R6-1):
 * - Without a scope, `locate` decides, as in run 5.
 * - In its own section, a repeated text is the occurrence whose two saved neighbours both match.
 *   A sole occurrence is the change unless it keeps neither saved neighbour while one of them is
 *   still elsewhere in the section: then it is other text, and the change is `missing`.
 *   (A proposal's new lines are unique in their section when written; see `uniqueInSection`.)
 * - When its section is unknown, a sole occurrence must keep a saved neighbour, and neither
 *   saved neighbour may be elsewhere in the note.
 */
export function locateChange(content: string, change: NoteChangeIdentity, mapSlug?: (slug: string) => string): LocateResult {
  const where = changeSection(content, change, mapSlug);
  const text = String(change.after ?? "");
  if (where.kind === "note") return locate(content, text, change.context);
  const lines = docLines(content);
  const span = spanLines(text);
  const range = where.kind === "section" ? where.range : { start: 0, end: lines.length };
  const found = occurrences(lines, span).filter((i) => i >= range.start && i < range.end);
  if (found.length === 0) return { status: "missing" };
  const context = change.context;
  const ok = (start: number): LocateResult => ({ status: "ok", start, length: span.length });
  if (found.length > 1) {
    const both = context ? found.filter((i) => {
      const c = contextAt(lines, i, span.length);
      return c.lineBefore === context.lineBefore && c.lineAfter === context.lineAfter;
    }) : [];
    return both.length === 1 ? ok(both[0]!) : { status: "ambiguous", count: found.length };
  }
  const at = found[0]!;
  if (!context) return ok(at);
  const c = contextAt(lines, at, span.length);
  const keeps = c.lineBefore === context.lineBefore || c.lineAfter === context.lineAfter;
  // A saved neighbour still in the region, but not beside this occurrence, says it is other text.
  const elsewhere = (saved: string | null, actual: string | null) => saved !== null && saved !== actual
    && lines.some((l, j) => j >= range.start && j < range.end && (j < at || j >= at + span.length) && l === saved);
  const contradicted = elsewhere(context.lineBefore, c.lineBefore) || elsewhere(context.lineAfter, c.lineAfter);
  if (where.kind === "section") return keeps || !contradicted ? ok(at) : { status: "missing" };
  return keeps && !contradicted ? ok(at) : { status: "missing" };
}

/**
 * Whether a scoped change's new lines, just written at `start`, are the only copy in its section,
 * so that the change can be found again later (R6-1). Changes without a section are not checked.
 */
export function uniqueInSection(content: string, change: NoteChangeIdentity, start: number): boolean {
  const where = changeSection(content, change);
  const span = spanLines(String(change.after ?? ""));
  if (span.length === 0) return true;
  if (where.kind === "section") {
    const found = occurrences(docLines(content), span).filter((i) => i >= where.range.start && i < where.range.end);
    return found.length === 1 && found[0] === start;
  }
  if (where.kind === "unknown") {
    const loc = locateChange(content, change);
    return loc.status === "ok" && loc.start === start;
  }
  return true;
}

/** Replace `length` lines at `start` with `replacement`, preserving the file's line endings. */
export function splice(content: string, start: number, length: number, replacement: string): string {
  const lines = docLines(content);
  lines.splice(start, length, ...spanLines(replacement));
  const joined = lines.join("\n");
  return usesCrlf(content) ? joined.replace(/\n/g, "\r\n") : joined;
}

/** Lines [start, end) of a note that an edit may touch: one section, or the whole note. */
export interface LineRange { start: number; end: number }
export interface SpanEdit { before: string; after: string; range?: LineRange }

/**
 * A section of a note as an edit scope: the heading line through the line before the next
 * heading, or the whole note for `null`. `text` is compared with the text a run read.
 */
export interface Scope { range: LineRange; text: string }
/** Part of a section that one read returned: lines counted from the section's first line. */
export interface ScopeLines { from: number; count: number }
export function scopeOf(content: string, headingSlug: string | null, headings: Array<{ slug: string; line: number }>, part?: ScopeLines): Scope | null {
  const lines = docLines(content);
  let start = 0;
  let end = lines.length;
  if (headingSlug !== null) {
    const i = headings.findIndex((h) => h.slug === headingSlug);
    if (i < 0) return null;
    start = headings[i]!.line;
    end = headings[i + 1]?.line ?? lines.length;
  }
  if (part) {
    // The exact raw lines a read returned (R5-8), heading line included when part.from is 0.
    const from = start + part.from;
    const to = from + part.count;
    if (to > end) return null;
    return { range: { start: from, end: to }, text: lines.slice(from, to).join("\n") };
  }
  if (headingSlug === null) return { range: { start: 0, end: lines.length }, text: toLf(content).trim() };
  return { range: { start, end }, text: lines.slice(start + 1, end).join("\n").trim() };
}

/**
 * The raw lines of a section (or the whole note) in parts of at most `maxChars`, whole lines
 * only (R6-9). A single line too long for that is a part of its own, marked `oversized`: it
 * cannot be shown whole, so it cannot be edited.
 */
export function sectionParts(content: string, headingSlug: string | null, headings: Array<{ slug: string; line: number }>, maxChars: number): Array<ScopeLines & { text: string; oversized: boolean }> | null {
  const lines = docLines(content);
  let start = 0;
  let end = lines.length;
  if (headingSlug !== null) {
    const i = headings.findIndex((h) => h.slug === headingSlug);
    if (i < 0) return null;
    start = headings[i]!.line;
    end = headings[i + 1]?.line ?? lines.length;
  }
  // Split at whole lines; trailing blank lines never form a part of their own, and the last
  // part runs to the end of the section, so a line added anywhere after it changes its hash.
  let last = end;
  while (last > start + 1 && (lines[last - 1] ?? "").trim() === "") last--;
  // The trailing blank lines join the last part, so they count towards its size.
  let tail = 0;
  for (let j = last; j < end; j++) tail += lines[j]!.length + 1;
  const cost = (j: number) => lines[j]!.length + 1 + (j + 1 === last ? tail : 0);
  const part = (from: number, to: number) => {
    const text = lines.slice(from, to).join("\n");
    return { from: from - start, count: to - from, text, oversized: text.length > maxChars };
  };
  const parts: Array<ScopeLines & { text: string; oversized: boolean }> = [];
  let from = start;
  while (from < last) {
    let to = from;
    let size = 0;
    while (to < last && (to === from || size + cost(to) <= maxChars)) { size += cost(to); to++; }
    if (to >= last) to = end;
    parts.push(part(from, to));
    from = to;
  }
  if (parts.length === 0) parts.push(part(start, Math.max(end, start + 1)));
  return parts;
}

/** Find `text` as whole lines, only inside `range` when one is given. */
function locateIn(content: string, text: string, range: LineRange | undefined): LocateResult {
  if (!range) return locate(content, text, null);
  const span = spanLines(text);
  const found = occurrences(docLines(content), span).filter((i) => i >= range.start && i + span.length <= range.end);
  if (found.length === 0) return { status: "missing" };
  if (found.length > 1) return { status: "ambiguous", count: found.length };
  return { status: "ok", start: found[0]!, length: span.length };
}

/**
 * Apply several non-overlapping edits that were each located uniquely in
 * `content` (inside its range, when an edit has one). Returns the new content
 * and, for each edit, where its `before` text was and where its `after` text
 * sits in the result, plus the neighbouring lines there.
 */
export function applyEdits(content: string, edits: SpanEdit[]):
  | { ok: true; content: string; placed: Array<{ start: number; length: number; context: SpanContext }>; located: Array<{ start: number; length: number }> }
  | { ok: false; index: number; reason: "missing" | "ambiguous" | "overlap" | "empty" } {
  const located: Array<{ index: number; start: number; length: number }> = [];
  for (const [index, edit] of edits.entries()) {
    if (spanLines(edit.before).length === 0) return { ok: false, index, reason: "empty" };
    const r = locateIn(content, edit.before, edit.range);
    if (r.status !== "ok") return { ok: false, index, reason: r.status };
    located.push({ index, start: r.start, length: r.length });
  }
  const sorted = [...located].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    if (sorted[i]!.start < prev.start + prev.length) return { ok: false, index: sorted[i]!.index, reason: "overlap" };
  }
  let result = content;
  for (const l of [...sorted].reverse()) result = splice(result, l.start, l.length, edits[l.index]!.after);
  const finalLines = docLines(result);
  const placed = new Array<{ start: number; length: number; context: SpanContext }>(edits.length);
  let delta = 0;
  for (const l of sorted) {
    const newLength = spanLines(edits[l.index]!.after).length;
    const start = l.start + delta;
    placed[l.index] = { start, length: newLength, context: contextAt(finalLines, start, newLength) };
    delta += newLength - l.length;
  }
  const original = new Array<{ start: number; length: number }>(edits.length);
  for (const l of located) original[l.index] = { start: l.start, length: l.length };
  return { ok: true, content: result, placed, located: original };
}

export function normaliseSpan(text: string): string {
  const lf = toLf(text);
  return lf === "" || lf.endsWith("\n") ? lf : lf + "\n";
}
