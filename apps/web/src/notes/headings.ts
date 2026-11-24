// Resolving a heading link (citation, issue link, outline) against the note on disk, following
// heading renames made by reviewed changes (Ask requirement 10.2).

export interface HeadingAlias { slug: string; to: string; toText: string; reason: "pending-rename" | "renamed" | "rename-rejected" }

/**
 * The slug to open for a `heading` parameter: the slug itself when it is on disk, otherwise
 * the end of its rename chain (at most five steps, so a cycle cannot loop). `via` is the last
 * rename followed, for the notice; null when no rename was needed. Returns null when not found.
 */
export function resolveHeadingParam(heading: string, onDisk: string[], aliases: HeadingAlias[]): { slug: string; via: HeadingAlias | null } | null {
  const has = (s: string) => onDisk.includes(s);
  if (has(heading)) return { slug: heading, via: null };
  let slug = heading;
  for (let i = 0; i < 5; i++) {
    const next = aliases.find((a) => a.slug === slug);
    if (!next) return null;
    if (has(next.to)) return { slug: next.to, via: next };
    slug = next.to;
  }
  return null;
}
