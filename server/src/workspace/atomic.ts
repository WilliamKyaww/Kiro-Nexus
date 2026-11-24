import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { faultPoint } from "../faults";
import { isNodeError } from "../errors";

export function sha256(data: string | Uint8Array): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Windows editors and antivirus can hold a file briefly; retry the rename. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const delays = [20, 50, 100, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const retriable = isNodeError(e) && ["EPERM", "EBUSY", "EACCES"].includes(e.code ?? "");
      const delay = delays[attempt];
      if (!retriable || delay === undefined) throw e;
      await sleep(delay);
    }
  }
}

/**
 * Atomic replace: write a dot-prefixed temporary file in the same folder,
 * flush it to disk, then rename it over the target. Readers see the old or
 * the new bytes, never a mixture.
 */
export async function atomicWrite(target: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(target)}.nexus-tmp-${randomBytes(6).toString("hex")}`);
  const handle = await open(tmp, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    faultPoint("atomic:before-rename");
    await renameWithRetry(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  // Flushing the directory entry is not supported on Windows; best effort elsewhere.
  if (process.platform !== "win32") {
    const d = await open(dir, "r").catch(() => null);
    await d?.sync().catch(() => undefined);
    await d?.close();
  }
}

/** Create a file only if it does not exist (exclusive), then flush. */
export async function createExclusive(target: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const handle = await open(target, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
