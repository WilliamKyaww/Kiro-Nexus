// One rule for [[wikilinks]], shared by the preview, the backlinks and completion
// (architecture 6, DEC-006; .kiro/specs/backlinks-completion, requirement 1).

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LINK = /\[\[([^[\]|#\n]+)(?:#([^[\]|\n]+))?(?:\|([^[\]\n]+))?\]\]/g;
const INLINE_CODE = /(`+)(.*?)\1/g;

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

/** Every [[link]] outside fenced code and inline code, as the preview renders them. */
export function linksIn(markdown: string): LinkInNote[] {
  const out: LinkInNote[] = [];
  let fence: { char: string; length: number } | null = null;
  markdown.split(/\r?\n/).forEach((text, line) => {
    const open = text.match(FENCE);
    if (open) {
      const marker = open[1] ?? "";
      const char = marker[0] ?? "`";
      if (!fence) fence = { char, length: marker.length };
      else if (char === fence.char && marker.length >= fence.length && text.trim() === marker) fence = null;
      return;
    }
    if (fence) return;
    // Blank out inline code, keeping the columns.
    const visible = text.replace(INLINE_CODE, (s) => " ".repeat(s.length));
    for (const m of visible.matchAll(LINK)) {
      out.push({ target: (m[1] ?? "").trim(), heading: m[2]?.trim() || null, alias: m[3]?.trim() || null, line, column: m.index ?? 0, lineText: text, raw: m[0] });
    }
  });
  return out;
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
