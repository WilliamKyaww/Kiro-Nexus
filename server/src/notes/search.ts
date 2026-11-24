// In-memory section search (PRD-022, PRD-054). Rebuildable from the Markdown at any time.
import MiniSearch from "minisearch";
import { sections } from "@nexus/markdown";
import type { WorkspaceService, ChangeEvent } from "../workspace/service";

interface SectionDoc {
  id: string;
  path: string;
  title: string;
  heading: string;
  text: string;
  headingSlug: string | null;
  headingText: string | null;
  headingPath: string[];
}

export interface SearchResult {
  path: string;
  headingSlug: string | null;
  headingText: string | null;
  headingPath: string[];
  snippet: string;
  score: number;
  /** The index terms that matched, so a caller can rebuild the snippet from other text. */
  terms: string[];
}

const MAX_NOTE_BYTES = 2_000_000;
const noteTitle = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

export class SearchIndex {
  private index = SearchIndex.fresh();
  private readonly idsByPath = new Map<string, string[]>();
  private readonly docs = new Map<string, SectionDoc>();
  private readonly onChange = (e: ChangeEvent) => {
    if (e.path.startsWith(".nexus/")) return;
    void (e.revision === null ? Promise.resolve(this.remove(e.path)) : this.reindex(e.path));
  };

  private constructor(private readonly service: WorkspaceService) {}

  private static fresh() {
    return new MiniSearch<SectionDoc>({
      fields: ["title", "heading", "text"],
      storeFields: ["path"],
      searchOptions: { boost: { heading: 3, title: 2 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
    });
  }

  static async build(service: WorkspaceService): Promise<SearchIndex> {
    const idx = new SearchIndex(service);
    for (const path of await service.listNotes()) await idx.reindex(path);
    service.events.on("change", idx.onChange);
    return idx;
  }

  dispose(): void {
    this.service.events.off("change", this.onChange);
  }

  remove(path: string): void {
    for (const id of this.idsByPath.get(path) ?? []) {
      if (this.index.has(id)) this.index.discard(id);
      this.docs.delete(id);
    }
    this.idsByPath.delete(path);
  }

  async reindex(path: string): Promise<void> {
    const raw = await this.service.readNoteRaw(path).catch(() => null);
    this.remove(path);
    if (!raw || raw.content.length > MAX_NOTE_BYTES) return;
    const docs = sectionDocs(raw.rel, raw.content);
    this.index.addAll(docs);
    for (const d of docs) this.docs.set(d.id, d);
    this.idsByPath.set(raw.rel, docs.map((d) => d.id));
  }

  search(query: string, limit = 20): SearchResult[] {
    return runSearch(this.index, this.docs, query, limit);
  }

  /**
   * Search notes given as text rather than as the files on disk (Ask uses this for the
   * accepted text of notes with edits awaiting review). Same options and fallback as search.
   */
  static searchContents(notes: Array<{ path: string; content: string }>, query: string, limit = 20): SearchResult[] {
    const index = SearchIndex.fresh();
    const docs = new Map<string, SectionDoc>();
    for (const n of notes) for (const d of sectionDocs(n.path, n.content)) { index.add(d); docs.set(d.id, d); }
    return runSearch(index, docs, query, limit);
  }
}

function sectionDocs(rel: string, content: string): SectionDoc[] {
  const docs: SectionDoc[] = sections(content).map((s, i) => ({
    id: `${rel}#${i}`,
    path: rel,
    title: noteTitle(rel),
    heading: s.headingPath.join(" "),
    text: s.text,
    headingSlug: s.headingSlug,
    headingText: s.headingText,
    headingPath: s.headingPath,
  }));
  if (docs.length === 0) docs.push({ id: `${rel}#0`, path: rel, title: noteTitle(rel), heading: "", text: "", headingSlug: null, headingText: null, headingPath: [] });
  return docs;
}

function runSearch(index: MiniSearch<SectionDoc>, docs: Map<string, SectionDoc>, query: string, limit: number): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  // All words first (precise). A natural-language question rarely matches every word,
  // so fall back to any word, still ranked by heading and title boosts.
  let hits = index.search(q);
  if (hits.length === 0 && /\s/.test(q)) hits = index.search(q, { combineWith: "OR" });
  return hits.slice(0, limit).flatMap((hit) => {
    const doc = docs.get(String(hit.id));
    if (!doc) return [];
    return [{
      path: doc.path, headingSlug: doc.headingSlug, headingText: doc.headingText, headingPath: doc.headingPath,
      snippet: snippet(doc.text, hit.terms), score: Math.round(hit.score * 100) / 100, terms: hit.terms,
    }];
  });
}

export function snippet(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const lower = flat.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 50);
  const end = Math.min(flat.length, at + 110);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
