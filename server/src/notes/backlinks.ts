// Backlinks (B2, PRD-021; .kiro/specs/backlinks-completion, requirement 2). Computed from the
// files when asked, through WorkspaceService, so an outside edit, a save, a restart and a
// workspace switch need no cache to stay right.
import type { BacklinkView } from "@nexus/schema";
import { linkDisplay, linksIn, parseHeadings, resolveHeading, resolveNoteTarget, slugOf } from "@nexus/markdown";
import { NexusError } from "../errors";
import type { WorkspaceService } from "../workspace/service";

/** Markdown markers at the start of a line that the context does not need. */
const LEAD = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+|>\s*)/;

export async function backlinksTo(service: WorkspaceService, path: string): Promise<BacklinkView[]> {
  const rel = service.notePath(path).rel;
  const target = await service.readNoteRaw(rel);
  if (!target) throw new NexusError("NOT_FOUND", `Note not found: ${rel}`);
  const notes = await service.listNotes();
  const headings = parseHeadings(target.content);
  const out: BacklinkView[] = [];
  for (const source of notes) {
    const raw = source === rel ? target : await service.readNoteRaw(source).catch(() => null);
    if (!raw) continue;
    const links = linksIn(raw.content);
    if (links.length === 0) continue;
    const sourceHeadings = parseHeadings(raw.content);
    for (const l of links) {
      const r = resolveNoteTarget(l.target, notes, source);
      const meansThis = r.status === "ok" ? r.path === rel : r.status === "ambiguous" && r.candidates.includes(rel);
      if (!meansThis) continue;
      const heading = l.heading ? resolveHeading(headings, slugOf(l.heading), l.heading) : null;
      const section = [...sourceHeadings].reverse().find((h) => h.line <= l.line) ?? null;
      const context = linkDisplay(l.lineText).replace(LEAD, "").trim();
      out.push({
        source, line: l.line,
        context: context.length > 240 ? `${context.slice(0, 239)}…` : context,
        sectionSlug: section?.slug ?? null, sectionText: section?.text ?? null,
        heading: l.heading, headingStatus: heading === null ? "none" : heading.status === "ok" ? "ok" : "missing", headingSlug: heading?.slug ?? null,
        alias: l.alias,
        candidates: r.status === "ambiguous" ? r.candidates : [],
      });
    }
  }
  return out.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line);
}
