// The only view of the workspace that Ask receives: read methods, no writes (PRD-051).
import type { SearchIndex } from "../notes/search";
import type { ReviewEngine } from "../review/engine";
import type { WorkspaceService } from "../workspace/service";
import type { ReadOnlyWorkspace } from "./tools";

export function readOnlyWorkspace(service: WorkspaceService, index: SearchIndex, engine: ReviewEngine | null): ReadOnlyWorkspace {
  return Object.freeze({
    manifest: Object.freeze(structuredClone(service.manifest)),
    search: (query: string, limit: number) => index.search(query, limit),
    readNote: async (path: string) => {
      const raw = await service.readNoteRaw(path).catch(() => null);
      return raw ? { path: raw.rel, content: raw.content } : null;
    },
    listNotes: () => service.listNotes(),
    projects: () => service.listProjects(),
    issues: () => service.listIssues(),
    unsettledChanges: () => engine?.unsettledChanges() ?? [],
  });
}
