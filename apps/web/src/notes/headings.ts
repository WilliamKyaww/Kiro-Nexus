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
 * Check a cited section against the text the citation read (`excerpt`: one line, or up to three
 * joined by "\n"; R5-10, R6-10). Every heading with the cited heading's name is a candidate,
 * the cited one included, and each is scored by how much of the excerpt its section holds: all
 * of it, in order, scores highest; otherwise each excerpt line it holds counts once.
 *
 * - The one candidate with the highest score is the cited section (`moved` when it is not the
 *   resolved one, because a heading of that name was added above it, say).
 * - When no candidate holds any of the excerpt, or several share the highest score (both
 *   sections start with "Status", say), the link is uncertain: the note page says that it
 *   cannot tell, rather than open one of them as if it were sure.
 *
 * Without an excerpt (citations from before run 6), nothing is checked.
 */
export function checkCitedSection(content: string, headings: Array<{ slug: string; text: string; line: number }>, slug: string, excerpt: string | null):
  { slug: string; moved: boolean; uncertain: boolean } {
  if (!excerpt) return { slug, moved: false, uncertain: false };
  const at = headings.findIndex((h) => h.slug === slug);
  if (at < 0) return { slug, moved: false, uncertain: false };
  const want = excerpt.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (want.length === 0) return { slug, moved: false, uncertain: false };
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const body = (i: number) => lines.slice(headings[i]!.line + 1, headings[i + 1]?.line ?? lines.length).map((l) => l.trim().slice(0, 120)).filter((l) => l !== "");
  const same = (line: string | undefined, w: string) => line !== undefined && (line === w || line.startsWith(w));
  const score = (i: number) => {
    const b = body(i);
    if (b.some((_, k) => want.every((w, j) => same(b[k + j], w)))) return want.length + 1;
    return want.filter((w) => b.some((l) => same(l, w))).length;
  };
  const scored = headings.map((h, i) => ({ h, i })).filter(({ h }) => h.text === headings[at]!.text).map((c) => ({ ...c, score: score(c.i) }));
  const best = Math.max(...scored.map((c) => c.score));
  const top = scored.filter((c) => c.score === best);
  if (best === 0 || top.length !== 1) return { slug, moved: false, uncertain: true };
  return { slug: top[0]!.h.slug, moved: top[0]!.i !== at, uncertain: false };
}
