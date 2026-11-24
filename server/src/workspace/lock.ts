import { open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { NexusError, isNodeError } from "../errors";

export interface LockInfo {
  pid: number;
  instanceId: string;
  port: number | null;
  startedAt: string;
}

export const lockPath = (root: string) => join(root, ".nexus", "lock");

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return isNodeError(e) && e.code === "EPERM";
  }
}

async function readLock(path: string): Promise<LockInfo | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Take the single-writer lock (R-S2). The lock file is created exclusively.
 * A lock held by a live process refuses with LOCKED; a lock whose pid is
 * not running is taken over and reported.
 */
export async function acquireLock(root: string, info: LockInfo): Promise<{ takenOverFrom: LockInfo | null }> {
  const path = lockPath(root);
  let takenOverFrom: LockInfo | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(JSON.stringify(info, null, 2) + "\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { takenOverFrom };
    } catch (e) {
      if (!isNodeError(e) || e.code !== "EEXIST") throw e;
      const existing = await readLock(path);
      if (existing?.instanceId === info.instanceId) return { takenOverFrom: null };
      if (existing && isProcessAlive(existing.pid)) {
        throw new NexusError("LOCKED", `This workspace is open in another Nexus instance (pid ${existing.pid}${existing.port ? `, port ${existing.port}` : ""}). Close it there, or delete .nexus/lock if that process is not Nexus.`, { holder: existing });
      }
      takenOverFrom = existing ?? { pid: -1, instanceId: "unreadable", port: null, startedAt: "" };
      await unlink(path).catch((err) => { if (!isNodeError(err) || err.code !== "ENOENT") throw err; });
    }
  }
  throw new NexusError("LOCKED", "Could not take the workspace lock after several attempts.");
}

export async function releaseLock(root: string, instanceId: string): Promise<void> {
  const path = lockPath(root);
  const existing = await readLock(path);
  if (existing?.instanceId === instanceId) await unlink(path).catch(() => undefined);
}
