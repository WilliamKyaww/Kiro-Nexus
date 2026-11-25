// One rule for [[wikilinks]], shared by the preview, the backlinks and completion
// (architecture 6, DEC-006; .kiro/specs/backlinks-completion, requirement 1).

const LINK = /\[\[([^[\]|#\n]+)(?:#([^[\]|\n]+))?(?:\|([^[\]\n]+))?\]\]/g;

/** The pattern the preview turns into links: a fresh copy, so callers do not share its lastIndex. */
export const wikilinkRegExp = () => new RegExp(LINK.source, "g");
/** Markdown nodes whose text the preview does not search for links (with code, R6-16). */
export const wikilinkIgnore = ["link", "linkReference", "inlineCode", "code"] as const;

export interface LinkInNote {
  target: string;
  heading: string | null;
  alias: string | null;
  /** Zero-based line, and the column of the opening [[. */
  line: number;
  column: number;
  lineText: string;
  raw: string;
}

// Which lines are code, by CommonMark's block rules (R6-16). The preview (remark) renders a
// fenced block and an indented block as code, so a [[link]] there is not a link. Indentation
// counts from the content of the list item or quote that holds the line: a list item's
// indented continuation is ordinary text, and an indented line cannot interrupt a paragraph.
// Code spans are found per paragraph or heading, so one may cross a line break.
// Checked against the preview's own parser (remark-parse with remark-gfm) on generated notes.
// Not modelled: HTML blocks, tables, link reference definitions, and the text of inline links,
// autolinks and HTML, which the preview does not link either.
type Box = { kind: "quote" } | { kind: "item"; indent: number; empty: boolean };
type Leaf = { kind: "fence"; char: string; length: number; depth: number } | { kind: "indented" } | { kind: "para"; id: number } | null;
/** One line's block context: whether it is code, and which paragraph (or heading) holds its text. */
interface LineBlock { code: boolean; inline: number }
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])( +|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}#{1,6}(?:\s|$)/;
const THEMATIC = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const SETEXT = /^ {0,3}(?:=+|-+) *$/;
const indentOf = (s: string) => s.length - s.trimStart().length;
/** Tabs as spaces to the next multiple of four (CommonMark 2.2). Only block structure reads this. */
const expandTabs = (s: string) => { let out = ""; for (const ch of s) out += ch === "\t" ? " ".repeat(4 - (out.length % 4)) : ch; return out; };
const startsBlock = (s: string) => indentOf(s) < 4 && (QUOTE.test(s) || ITEM.test(s) || FENCE.test(s) || ATX.test(s) || THEMATIC.test(s));

function blocks(lines: readonly string[]): LineBlock[] {
  const stack: Box[] = [];
  let leaf: Leaf = null;
  let inlines = 0;
  const text = (): LineBlock => ({ code: false, inline: leaf?.kind === "para" ? leaf.id : -1 });
  return lines.map((raw): LineBlock => {
    const s = raw.includes("\t") ? expandTabs(raw) : raw;
    let at = 0;
    let matched = 0;
    for (const box of stack) {
      const rest = s.slice(at);
      if (box.kind === "quote") {
        const q = QUOTE.exec(rest);
        if (!q) break;
        at += q[0].length;
      } else if (rest.trim() !== "") {
        if (indentOf(rest) < box.indent) break;
        at += box.indent;
      } else if (box.empty) {
        break; // a list item may start with one blank line, not two
      }
      matched++;
    }
    let rest = s.slice(at);
    const blank = rest.trim() === "";
    if (!blank) for (const box of stack.slice(0, matched)) if (box.kind === "item") box.empty = false;
    const fence = leaf?.kind === "fence" ? leaf : null;
    if (fence && matched >= fence.depth) {
      const close = FENCE.exec(rest);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length && close[2]!.trim() === "") leaf = null;
      return { code: true, inline: -1 };
    }
    // A paragraph or an indented block still open here is interrupted by a new list item only
    // when the item has text and, if numbered, starts at 1 (as the preview's parser does).
    const interrupt = matched === stack.length && (leaf?.kind === "para" || leaf?.kind === "indented");
    if (matched < stack.length) {
      // A paragraph's lazy continuation keeps its quotes and list items open.
      if (leaf?.kind === "para" && !blank && !startsBlock(rest)) return text();
      stack.length = matched;
      leaf = null;
    }
    if (leaf?.kind === "indented") {
      if (blank || indentOf(rest) >= 4) return { code: true, inline: -1 };
      leaf = null;
    }
    // A setext underline turns the paragraph above into a heading, which ends it.
    if (leaf?.kind === "para" && SETEXT.test(rest)) { leaf = null; return { code: false, inline: -1 }; }
    for (;;) {
      if (indentOf(rest) >= 4 || THEMATIC.test(rest)) break;
      const q = QUOTE.exec(rest);
      const item = q ? null : ITEM.exec(rest);
      if (!q && !item) break;
      if (q) {
        stack.push({ kind: "quote" });
        at += q[0].length;
      } else {
        const empty = s.slice(at + item![0].length).trim() === "";
        if (interrupt && (empty || (/\d/.test(item![2]!) && !/^1[.)]$/.test(item![2]!)))) break;
        const width = item![1]!.length + item![2]!.length;
        const spaces = item![3]!.length;
        // Five or more spaces after the marker: the item's text starts one space in, so the rest is indented code.
        const indent = empty || spaces >= 5 ? width + 1 : width + spaces;
        stack.push({ kind: "item", indent, empty });
        at += indent;
      }
      rest = s.slice(at);
      leaf = null;
    }
    if (rest.trim() === "") { if (leaf?.kind === "para") leaf = null; return { code: false, inline: -1 }; }
    const open = FENCE.exec(rest);
    if (open && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      leaf = { kind: "fence", char: open[1]![0]!, length: open[1]!.length, depth: stack.length };
      return { code: true, inline: -1 };
    }
    if (indentOf(rest) >= 4 && leaf?.kind !== "para") { leaf = { kind: "indented" }; return { code: true, inline: -1 }; }
    if (THEMATIC.test(rest)) { leaf = null; return { code: false, inline: -1 }; }
    if (ATX.test(rest)) { leaf = null; return { code: false, inline: inlines++ }; }
    if (leaf?.kind !== "para") leaf = { kind: "para", id: inlines++ };
    return text();
  });
}

/** For each line of the note, whether the preview renders it inside a code block. */
export function codeLines(markdown: string): boolean[] {
  return blocks(markdown.split(/\r?\n/)).map((b) => b.code);
}

/**
 * The code spans of one paragraph or heading, whose lines are joined with "\n": a run of
 * backticks up to the next run of the same length (CommonMark 6.1). A backslash escapes a
 * backtick outside a span, not inside one.
 */
function codeSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const runAt = (i: number) => { let j = i; while (text[j] === "`") j++; return j - i; };
  for (let i = 0; i < text.length;) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] !== "`") { i++; continue; }
    const n = runAt(i);
    let close = -1;
    for (let j = i + n; j < text.length;) {
      if (text[j] !== "`") { j++; continue; }
      const m = runAt(j);
      if (m === n) { close = j; break; }
      j += m;
    }
    if (close < 0) { i += n; continue; }
    out.push([i, close + n]);
    i = close + n;
  }
  return out;
}

/** Each line with its code spans blanked out (columns kept), or null for a line of a code block. */
function visibleLines(lines: readonly string[]): Array<string | null> {
  const info = blocks(lines);
  const out: Array<string | null> = lines.map((l, i) => (info[i]!.code ? null : l));
  for (let i = 0; i < lines.length;) {
    const id = info[i]!.inline;
    let end = i + 1;
    if (id >= 0) while (end < lines.length && info[end]!.inline === id) end++;
    if (id >= 0) {
      const joined = lines.slice(i, end).join("\n");
      const starts = lines.slice(i, end).reduce<number[]>((acc, l, k) => [...acc, k === 0 ? 0 : acc[k - 1]! + lines[i + k - 1]!.length + 1], []);
      for (const [from, to] of codeSpans(joined)) {
        starts.forEach((start, k) => {
          const a = Math.max(from, start) - start;
          const b = Math.min(to, start + lines[i + k]!.length) - start;
          if (b > a) out[i + k] = out[i + k]!.slice(0, a) + " ".repeat(b - a) + out[i + k]!.slice(b);
        });
      }
    }
    i = end;
  }
  return out;
}

/** Every [[link]] outside code (fenced, indented and inline), as the preview renders them. */
export function linksIn(markdown: string): LinkInNote[] {
  const out: LinkInNote[] = [];
  const lines = markdown.split(/\r?\n/);
  visibleLines(lines).forEach((visible, line) => {
    if (visible === null) return;
    for (const m of visible.matchAll(LINK)) {
      out.push({ target: (m[1] ?? "").trim(), heading: m[2]?.trim() || null, alias: m[3]?.trim() || null, line, column: m.index ?? 0, lineText: lines[line]!, raw: m[0] });
    }
  });
  return out;
}

/** Whether a position in the note is inside code, where [[ starts no link (completion, R6-16). */
export function inCodeAt(markdown: string, offset: number): boolean {
  const before = markdown.slice(0, offset);
  const line = before.split("\n").length - 1;
  const column = offset - (before.lastIndexOf("\n") + 1);
  const visible = visibleLines(markdown.split(/\r?\n/))[line];
  return visible === null || visible === undefined || (visible[column] === " " && markdown[offset] !== " ");
}

const nearby = (lines: readonly string[], i: number): [string | null, string | null] => {
  let b = i - 1;
  while (b >= 0 && !lines[b]!.trim()) b--;
  let a = i + 1;
  while (a < lines.length && !lines[a]!.trim()) a++;
  return [b >= 0 ? lines[b]! : null, a < lines.length ? lines[a]! : null];
};
const where = (lines: readonly string[], test: (text: string) => boolean) => lines.flatMap((t, i) => (test(t) ? [i] : []));

/**
 * The line of an unsaved draft that holds a link found on `line` of the saved note (R6-13), or
 * null when that cannot be told with certainty. The saved line is found again in the draft when
 * it is there once, or, when it is repeated, when exactly one copy has the same nearest
 * non-blank neighbours in both versions. A changed line is followed only by its link (`raw`),
 * when that is on exactly one line of each version. Otherwise nothing is guessed.
 */
export function lineInDraft(saved: string, draft: string, line: number, raw: string | null): number | null {
  const a = saved.split(/\r?\n/);
  const b = draft.split(/\r?\n/);
  const text = a[line];
  if (text === undefined || !text.trim() || (raw !== null && !text.includes(raw))) return null;
  if (saved === draft) return line;
  const inDraft = where(b, (t) => t === text);
  if (inDraft.length > 0) {
    const inSaved = where(a, (t) => t === text);
    if (inSaved.length === 1 && inDraft.length === 1) return inDraft[0]!;
    const [before, after] = nearby(a, line);
    const same = (lines: readonly string[]) => (i: number) => { const [x, y] = nearby(lines, i); return x === before && y === after; };
    const savedNear = inSaved.filter(same(a));
    const draftNear = inDraft.filter(same(b));
    return savedNear.length === 1 && draftNear.length === 1 ? draftNear[0]! : null;
  }
  if (raw === null) return null;
  const savedLinks = where(a, (t) => t.includes(raw));
  const draftLinks = where(b, (t) => t.includes(raw));
  return savedLinks.length === 1 && draftLinks.length === 1 ? draftLinks[0]! : null;
}

export type NoteResolution =
  | { status: "ok"; path: string }
  | { status: "missing" }
  | { status: "ambiguous"; candidates: string[] };

const stem = (p: string) => p.toLowerCase().replace(/\\/g, "/").replace(/\.md$/i, "");
const fileName = (p: string) => stem(p).split("/").pop() ?? "";
const folders = (p: string) => stem(p).split("/").slice(0, -1);

/**
 * The note a target means: the note at that path, otherwise the notes whose path ends with it
 * (usually just the file name). Several of those: the one closest to the linking note, by
 * shared leading folders, then by fewest folders. Equally close ones make the link ambiguous,
 * and the candidates are named rather than one picked.
 */
export function resolveNoteTarget(target: string, notes: readonly string[], from: string | null = null): NoteResolution {
  const wanted = stem(target.trim()).replace(/^\.?\//, "");
  if (!wanted) return { status: "missing" };
  const matches = notes.filter((p) => stem(p) === wanted || stem(p).endsWith(`/${wanted}`));
  if (matches.length === 0) return { status: "missing" };
  const exact = matches.filter((p) => stem(p) === wanted);
  if (exact.length === 1) return { status: "ok", path: exact[0]! };
  if (matches.length === 1) return { status: "ok", path: matches[0]! };
  const near = from ? folders(from) : [];
  const score = (p: string) => {
    const f = folders(p);
    let shared = 0;
    while (shared < f.length && shared < near.length && f[shared] === near[shared]) shared++;
    return { shared, depth: f.length };
  };
  const scored = matches.map((p) => ({ p, ...score(p) })).sort((a, b) => b.shared - a.shared || a.depth - b.depth || a.p.localeCompare(b.p));
  const best = scored[0]!;
  const tied = scored.filter((s) => s.shared === best.shared && s.depth === best.depth).map((s) => s.p);
  return tied.length === 1 ? { status: "ok", path: tied[0]! } : { status: "ambiguous", candidates: tied };
}

/** The target to write for a note: its file name, or its path when another note has that name. */
export function noteTargetFor(path: string, notes: readonly string[]): string {
  const name = path.replace(/\\/g, "/").replace(/\.md$/i, "");
  const short = name.split("/").pop() ?? name;
  const shared = notes.filter((p) => fileName(p) === short.toLowerCase()).length;
  return shared > 1 ? name : short;
}

/** A line with each link as the preview shows it: the alias, "Name › Heading", or the name. */
export function linkDisplay(line: string): string {
  return line.replace(LINK, (_all, target: string, heading?: string, alias?: string) => alias?.trim() || (heading?.trim() ? `${target.trim()} › ${heading.trim()}` : target.trim()));
}
