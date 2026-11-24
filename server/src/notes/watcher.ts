// Watches the workspace for edits made outside Nexus (PRD-023).
import { relative, sep } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { WorkspaceService } from "../workspace/service";

export function isWatched(root: string, path: string, isFile: boolean | undefined): boolean {
  const rel = relative(root, path);
  if (!rel) return true;
  const segments = rel.split(sep);
  if (segments[0] === ".nexus") return segments.length === 1 || (segments.length === 2 && ["issues.json", "projects.json"].includes(segments[1] ?? ""));
  if (segments.some((s) => s.startsWith(".") || s === "node_modules")) return false;
  if (isFile && !rel.toLowerCase().endsWith(".md")) return false;
  return true;
}

export async function startWatcher(service: WorkspaceService, log: (l: string) => void): Promise<FSWatcher> {
  const root = service.root;
  const watcher = watch(root, {
    ignoreInitial: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    ignored: (path, stats) => !isWatched(root, path, stats?.isFile()),
  });
  const handle = (path: string) => {
    const rel = relative(root, path).split(sep).join("/");
    const task = rel === ".nexus/issues.json" ? service.externalCollectionChanged("issues")
      : rel === ".nexus/projects.json" ? service.externalCollectionChanged("projects")
      : rel.toLowerCase().endsWith(".md") ? service.externalNoteChanged(rel)
      : Promise.resolve(false);
    task.then((changed) => { if (changed) log("watcher: change detected outside Nexus"); })
      .catch((e: Error) => log(`watcher: ${e.message.slice(0, 120)}`));
  };
  watcher.on("add", handle).on("change", handle).on("unlink", handle);
  watcher.on("error", (e) => log(`watcher: error ${(e as Error).message?.slice(0, 120) ?? e}`));
  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  service.events.on("warning", (msg: string) => log(`workspace: ${msg}`));
  return watcher;
}
