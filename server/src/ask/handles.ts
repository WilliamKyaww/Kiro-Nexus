// Run-scoped citation handles (PRD-052): every source returned to the model gets S1, S2, …
import type { Due } from "@nexus/schema";

export type CitationTarget =
  /**
   * `excerpt` (since run 6) is the text the run read at the start of that section, so a link
   * can find its section again when another heading of the same name is added (R5-10). It is
   * one line, or up to three joined by "\n" when the first is a short label (R6-10). Citations
   * saved before R6-10 hold one line, and are read the same way.
   */
  | { kind: "note"; path: string; headingSlug: string | null; headingText: string | null; excerpt?: string | null }
  | { kind: "issue"; key: string };

const EXCERPT_LINES = 3;
const EXCERPT_LINE_CHARS = 120;

/**
 * The first lines of a section's text that are not blank or a heading, each at most 120
 * characters. One line is enough when it has two words of four or more letters, or 40
 * characters; a shorter one ("Status", "TBC") is a label that other sections may start with
 * too, so the next lines are added, up to three (R6-10).
 */
export function excerptOf(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !/^#{1,6}(\s|$)/.test(l));
  const out: string[] = [];
  for (const line of lines) {
    out.push(line.slice(0, EXCERPT_LINE_CHARS));
    const joined = out.join(" ");
    if (out.length >= EXCERPT_LINES || joined.length >= 40 || (joined.match(/[A-Za-z0-9]{4,}/g) ?? []).length >= 2) break;
  }
  return out.length ? out.join("\n") : null;
}

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
  /** An issue record's fields as returned to the model (accepted values, architecture 7.7). */
  issue?: { key: string; title: string; description: string; status: string; due?: Due };
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
    const c = this.byHandle.get(handle);
    if (c?.target.kind === "note" && !c.target.excerpt && evidence.sectionText) c.target.excerpt = excerptOf(evidence.sectionText);
  }

  evidenceOf(handle: string): Evidence | undefined { return this.evidence.get(handle); }
  get(handle: string): Citation | undefined { return this.byHandle.get(handle.trim()); }
  all(): Citation[] { return [...this.byHandle.values()]; }
}

/** Task-list items (`- [ ]`, `- [x]`, `* [ ]`) of a Markdown section. */
export function taskItems(text: string): Array<{ text: string; done: boolean }> {
  return [...text.matchAll(/^\s*[-*+] \[( |x|X)\] (.+)$/gm)].map((m) => ({ done: m[1]!.toLowerCase() === "x", text: m[2]!.trim() }));
}
