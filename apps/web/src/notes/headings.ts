// Resolving a heading link (citation, issue link, outline) against the note on disk, following
// heading moves made by reviewed changes (Ask requirement 10.2, R4-8).

export interface HeadingAlias {
  slug: string;
  to: string;
  toText: string;
  /** uncertain: another heading was renamed to this name, and it is not known how links moved (R5-10). */
  reason: "pending-rename" | "renamed" | "rename-rejected" | "uncertain";
  /** The text the slug belongs to: "accepted" (Ask citations) or "disk". Absent from older services. */
  ref?: "accepted" | "disk";
  /** When the move was decided; null while it exists only because an edit is pending. */
  at?: string | null;
}

/** What a heading link points into: the accepted text at a time (an Ask citation), or the text on disk. */
export interface HeadingRef { ref?: "accepted" | "disk"; at?: string | null }

/**
 * The slug to open for a `heading` parameter, or null when it is not found. `via` is the last
 * move followed, for the notice; null when none was needed.
 *
 * A citation names a heading of the accepted text as it was when the answer was given. It
 * follows the moves of accepted headings decided after that time, then maps the accepted
 * heading to the same heading on disk while edits are pending. This holds even when its slug
 * also exists on disk as a different section, for example after a heading was renamed to the
 * name of another one.
 *
 * Any other link names a heading on disk: the slug itself when it is on disk, otherwise the end
 * of its chain of moves (at most five steps, so a cycle cannot loop).
 */
export function resolveHeadingParam(heading: string, onDisk: string[], aliases: HeadingAlias[], ref: HeadingRef = {}): { slug: string; via: HeadingAlias | null } | null {
  const has = (s: string) => onDisk.includes(s);
  let slug = heading;
  let via: HeadingAlias | null = null;
  if (ref.ref === "accepted") {
    if (ref.at) {
      // One decision's moves apply together (alpha→beta and beta→beta-1 must not chain), and
      // decisions apply in the order they were made.
      const decisions = new Map<string, HeadingAlias[]>();
      for (const a of aliases) {
        if (a.ref !== "accepted" || a.reason !== "renamed" || !a.at || a.at <= ref.at) continue;
        decisions.set(a.at, [...(decisions.get(a.at) ?? []), a]);
      }
      for (const at of [...decisions.keys()].sort()) {
        const m = decisions.get(at)!.find((x) => x.slug === slug);
        if (m) { slug = m.to; via = m; }
      }
    }
    // A later rename gave another heading this name, and how the slugs moved is not known.
    const uncertain = ref.at ? aliases.find((a) => a.reason === "uncertain" && a.slug === slug && !!a.at && a.at > ref.at!) : undefined;
    if (uncertain) via = uncertain;
    const pending = aliases.find((a) => a.ref === "accepted" && a.reason === "pending-rename" && a.slug === slug);
    if (pending) { slug = pending.to; via = pending; }
    if (has(slug)) return { slug, via };
  }
  if (has(slug)) return { slug, via };
  for (let i = 0; i < 5; i++) {
    const next = aliases.find((a) => a.slug === slug && a.reason !== "pending-rename" && a.reason !== "uncertain") ?? aliases.find((a) => a.slug === slug && a.reason !== "uncertain");
    if (!next) return null;
    via = next;
    if (has(next.to)) return { slug: next.to, via };
    slug = next.to;
  }
  return null;
}

/**
 * Check a cited section against the line of text the citation read (`excerpt`, R5-10). When
 * the section no longer holds it but exactly one other heading of the same name does (a
 * heading of that name was added above it, say), that one is the cited section. When none
 * does, the link is uncertain. Without an excerpt (citations from before run 6), nothing is
 * checked.
 */
export function checkCitedSection(content: string, headings: Array<{ slug: string; text: string; line: number }>, slug: string, excerpt: string | null):
  { slug: string; moved: boolean; uncertain: boolean } {
  if (!excerpt) return { slug, moved: false, uncertain: false };
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const body = (i: number) => lines.slice(headings[i]!.line + 1, headings[i + 1]?.line ?? lines.length).map((l) => l.trim().slice(0, 120));
  const holds = (i: number) => body(i).some((l) => l === excerpt || l.startsWith(excerpt));
  const at = headings.findIndex((h) => h.slug === slug);
  if (at < 0) return { slug, moved: false, uncertain: false };
  if (holds(at)) return { slug, moved: false, uncertain: false };
  const others = headings.map((h, i) => ({ h, i })).filter(({ h, i }) => i !== at && h.text === headings[at]!.text && holds(i));
  if (others.length === 1) return { slug: others[0]!.h.slug, moved: true, uncertain: false };
  return { slug, moved: false, uncertain: true };
}
