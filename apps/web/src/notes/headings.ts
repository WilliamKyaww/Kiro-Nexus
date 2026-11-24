// Resolving a heading link (citation, issue link, outline) against the note on disk, following
// heading moves made by reviewed changes (Ask requirement 10.2, R4-8).

export interface HeadingAlias {
  slug: string;
  to: string;
  toText: string;
  reason: "pending-rename" | "renamed" | "rename-rejected";
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
    const pending = aliases.find((a) => a.ref === "accepted" && a.reason === "pending-rename" && a.slug === slug);
    if (pending) { slug = pending.to; via = pending; }
    if (has(slug)) return { slug, via };
  }
  if (has(slug)) return { slug, via };
  for (let i = 0; i < 5; i++) {
    const next = aliases.find((a) => a.slug === slug && a.reason !== "pending-rename") ?? aliases.find((a) => a.slug === slug);
    if (!next) return null;
    via = next;
    if (has(next.to)) return { slug: next.to, via };
    slug = next.to;
  }
  return null;
}
