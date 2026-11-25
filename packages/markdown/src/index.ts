// Shared Markdown helpers used by the service and the UI.
import GithubSlugger from "github-slugger";

export * from "./links";

export interface Heading {
  depth: number;
  /** Plain text of the heading, inline markup removed. */
  text: string;
  /** GitHub-style slug, de-duplicated in document order (`actions`, `actions-1`). */
  slug: string;
  /** Zero-based line index in the source. */
  line: number;
}

const fenceOpen = /^ {0,3}(`{3,}|~{3,})/;
const atxHeading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** Strip common inline Markdown so slugs match the rendered text. */
export function plainHeadingText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]|]+)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .trim();
}

/** ATX headings outside fenced code blocks. Setext headings are not supported (documented in data-format.md). */
export function parseHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  const lines = markdown.split(/\r?\n/);
  let fence: { char: string; length: number } | null = null;
  lines.forEach((line, index) => {
    const fenceMatch = line.match(fenceOpen);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      const char = marker[0] ?? "`";
      if (!fence) fence = { char, length: marker.length };
      else if (char === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null;
      return;
    }
    if (fence) return;
    const m = line.match(atxHeading);
    if (!m) return;
    const text = plainHeadingText(m[2] ?? "");
    headings.push({ depth: (m[1] ?? "#").length, text, slug: slugger.slug(text), line: index });
  });
  return headings;
}

export interface Wikilink { target: string; heading: string | null; alias: string | null; index: number; raw: string }
export const wikilinkPattern = /\[\[([^[\]|#\n]+)(?:#([^[\]|\n]+))?(?:\|([^[\]\n]+))?\]\]/g;

export function parseWikilinks(markdown: string): Wikilink[] {
  const out: Wikilink[] = [];
  for (const m of markdown.matchAll(wikilinkPattern)) {
    out.push({ target: (m[1] ?? "").trim(), heading: m[2]?.trim() ?? null, alias: m[3]?.trim() ?? null, index: m.index ?? 0, raw: m[0] });
  }
  return out;
}

export interface Section {
  /** null for text before the first heading. */
  headingSlug: string | null;
  headingText: string | null;
  /** Ancestor headings and this one, e.g. ["Kickoff", "Actions"]. */
  headingPath: string[];
  startLine: number;
  text: string;
}

/** Split a note into sections: each heading with its text up to the next heading. */
export function sections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const headings = parseHeadings(markdown);
  const out: Section[] = [];
  const firstLine = headings[0]?.line ?? lines.length;
  const preamble = lines.slice(0, firstLine).join("\n").trim();
  if (preamble) out.push({ headingSlug: null, headingText: null, headingPath: [], startLine: 0, text: preamble });
  const stack: Heading[] = [];
  headings.forEach((h, i) => {
    while (stack.length && (stack[stack.length - 1]?.depth ?? 0) >= h.depth) stack.pop();
    stack.push(h);
    const end = headings[i + 1]?.line ?? lines.length;
    out.push({
      headingSlug: h.slug,
      headingText: h.text,
      headingPath: stack.map((s) => s.text),
      startLine: h.line,
      text: lines.slice(h.line + 1, end).join("\n").trim(),
    });
  });
  return out;
}

/** Slug a single heading text the same way parseHeadings does for its first occurrence. */
export function slugOf(text: string): string {
  return new GithubSlugger().slug(plainHeadingText(text));
}

/**
 * Resolve a heading link: exact slug first, then a unique heading with the
 * same text (DEC-006). Returns the slug to scroll to, or null.
 */
export function resolveHeading(headings: Heading[], slug: string | null, text: string | null): { slug: string | null; status: "ok" | "heading-missing" } {
  if (slug === null && text === null) return { slug: null, status: "ok" };
  if (slug !== null && headings.some((h) => h.slug === slug)) return { slug, status: "ok" };
  if (text !== null) {
    const matches = headings.filter((h) => h.text === text);
    if (matches.length === 1 && matches[0]) return { slug: matches[0].slug, status: "ok" };
  }
  return { slug: null, status: "heading-missing" };
}
