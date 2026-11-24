// Wires search and the external-change watcher into the service lifecycle (B2).
import type { FastifyInstance } from "fastify";
import type { FSWatcher } from "chokidar";
import { NexusError } from "../errors";
import type { AppState } from "../state";
import { SearchIndex } from "./search";
import { startWatcher } from "./watcher";

const indexes = new WeakMap<AppState, SearchIndex>();
const watchers = new WeakMap<AppState, FSWatcher>();

export function installNotes(state: AppState): void {
  state.onOpen.push(async (service) => {
    indexes.set(state, await SearchIndex.build(service));
    if (process.env.NEXUS_NO_WATCH !== "1") watchers.set(state, await startWatcher(service, state.log));
  });
  state.onClose.push(async () => {
    indexes.get(state)?.dispose();
    indexes.delete(state);
    await watchers.get(state)?.close();
    watchers.delete(state);
  });
}

export function searchIndexFor(state: AppState): SearchIndex {
  const index = indexes.get(state);
  if (!index || !state.service) throw new NexusError("NO_WORKSPACE", "No workspace is open.");
  return index;
}

export function notesRoutes(state: AppState) {
  return (app: FastifyInstance) => {
    app.get("/api/v1/search", async (request) => {
      const q = String((request.query as { q?: string }).q ?? "").slice(0, 200);
      const index = indexes.get(state);
      if (!index || !state.service) throw new NexusError("NO_WORKSPACE", "No workspace is open.");
      return { results: index.search(q) };
    });
  };
}
