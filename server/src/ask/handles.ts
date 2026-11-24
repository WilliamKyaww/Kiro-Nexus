// Run-scoped citation handles (PRD-052): every source returned to the model gets S1, S2, …
export type CitationTarget =
  | { kind: "note"; path: string; headingSlug: string | null; headingText: string | null }
  | { kind: "issue"; key: string };

export interface Citation { handle: string; label: string; target: CitationTarget }

export class HandleRegistry {
  private readonly byKey = new Map<string, Citation>();
  private readonly byHandle = new Map<string, Citation>();

  private add(key: string, label: string, target: CitationTarget): string {
    const existing = this.byKey.get(key);
    if (existing) return existing.handle;
    const c: Citation = { handle: `S${this.byKey.size + 1}`, label, target };
    this.byKey.set(key, c);
    this.byHandle.set(c.handle, c);
    return c.handle;
  }

  note(path: string, headingSlug: string | null, headingPath: string[]): string {
    const noteName = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
    const label = headingPath.length ? headingPath.join(" › ") : noteName;
    return this.add(`note:${path}#${headingSlug ?? "_top"}`, label, { kind: "note", path, headingSlug, headingText: headingPath[headingPath.length - 1] ?? null });
  }

  issue(key: string, title: string): string {
    return this.add(`issue:${key}`, `${key} ${title}`, { kind: "issue", key });
  }

  get(handle: string): Citation | undefined { return this.byHandle.get(handle.trim()); }
  all(): Citation[] { return [...this.byHandle.values()]; }
}
