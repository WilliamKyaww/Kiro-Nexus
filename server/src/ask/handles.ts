// Run-scoped citation handles (PRD-052): every source returned to the model gets S1, S2, …
export type CitationTarget =
  | { kind: "note"; path: string; headingSlug: string | null; headingText: string | null }
  | { kind: "issue"; key: string };

export interface Citation { handle: string; label: string; target: CitationTarget }

/**
 * What the run actually saw behind a handle. It is kept for the server's own checks
 * (requirement 8) and never stored in the conversation file.
 */
export interface Evidence {
  /** A note section's text as read in this run (search snippets do not count). */
  sectionText?: string;
  /** Task-list items of that section. */
  tasks?: Array<{ text: string; done: boolean }>;
  /** An issue record's fields as returned to the model. */
  issue?: { key: string; title: string; description: string; status: string };
}

export class HandleRegistry {
  private readonly byKey = new Map<string, Citation>();
  private readonly byHandle = new Map<string, Citation>();
  private readonly evidence = new Map<string, Evidence>();

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

  /** Record what was read behind a handle (merged with anything already recorded). */
  saw(handle: string, evidence: Evidence): void {
    this.evidence.set(handle, { ...this.evidence.get(handle), ...evidence });
  }

  evidenceOf(handle: string): Evidence | undefined { return this.evidence.get(handle); }
  get(handle: string): Citation | undefined { return this.byHandle.get(handle.trim()); }
  all(): Citation[] { return [...this.byHandle.values()]; }
}

/** Task-list items (`- [ ]`, `- [x]`, `* [ ]`) of a Markdown section. */
export function taskItems(text: string): Array<{ text: string; done: boolean }> {
  return [...text.matchAll(/^\s*[-*+] \[( |x|X)\] (.+)$/gm)].map((m) => ({ done: m[1]!.toLowerCase() === "x", text: m[2]!.trim() }));
}
