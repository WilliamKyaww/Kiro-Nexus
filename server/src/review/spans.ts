// Pure, line-aligned span logic for note changes (architecture 7.4, DEC-012).
// Content is handled as LF internally; CRLF files are written back as CRLF.

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

/** Find `text` in `content`; neighbouring lines disambiguate repeats. Never guesses. */
export function locate(content: string, text: string, context: SpanContext | null): LocateResult {
  const lines = docLines(content);
  const span = spanLines(text);
  const found = occurrences(lines, span);
  if (found.length === 0) return { status: "missing" };
  if (found.length === 1) return { status: "ok", start: found[0]!, length: span.length };
  if (context) {
    const matching = found.filter((i) => {
      const c = contextAt(lines, i, span.length);
      return c.lineBefore === context.lineBefore && c.lineAfter === context.lineAfter;
    });
    if (matching.length === 1) return { status: "ok", start: matching[0]!, length: span.length };
  }
  return { status: "ambiguous", count: found.length };
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
export function scopeOf(content: string, headingSlug: string | null, headings: Array<{ slug: string; line: number }>): Scope | null {
  const lines = docLines(content);
  if (headingSlug === null) return { range: { start: 0, end: lines.length }, text: toLf(content).trim() };
  const i = headings.findIndex((h) => h.slug === headingSlug);
  if (i < 0) return null;
  const start = headings[i]!.line;
  const end = headings[i + 1]?.line ?? lines.length;
  return { range: { start, end }, text: lines.slice(start + 1, end).join("\n").trim() };
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
