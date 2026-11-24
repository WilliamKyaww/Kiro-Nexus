// Per-user profile folder: service.json (control channel) and recent.json.
// Never inside a workspace. Tests and trials pass an isolated folder.
import { mkdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWrite } from "./workspace/atomic";

export function resolveProfileDir(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.NEXUS_PROFILE_DIR) return resolve(process.env.NEXUS_PROFILE_DIR);
  const base = process.env.APPDATA ?? join(homedir(), ".config");
  return join(base, "Nexus");
}

export interface ServiceFile {
  pid: number;
  port: number;
  instanceId: string;
  controlSecret: string;
  startedAt: string;
}

export const serviceFilePath = (profile: string) => join(profile, "service.json");

export async function writeServiceFile(profile: string, info: ServiceFile): Promise<void> {
  await mkdir(profile, { recursive: true });
  await atomicWrite(serviceFilePath(profile), JSON.stringify(info, null, 2) + "\n");
}

export async function readServiceFile(profile: string): Promise<ServiceFile | null> {
  try {
    return JSON.parse(await readFile(serviceFilePath(profile), "utf8")) as ServiceFile;
  } catch {
    return null;
  }
}

export async function removeServiceFile(profile: string, instanceId: string): Promise<void> {
  const current = await readServiceFile(profile);
  if (current?.instanceId === instanceId) await unlink(serviceFilePath(profile)).catch(() => undefined);
}

export interface RecentEntry { path: string; openedAt: string }

export async function readRecent(profile: string): Promise<RecentEntry[]> {
  try {
    const data = JSON.parse(await readFile(join(profile, "recent.json"), "utf8")) as { recent?: RecentEntry[] };
    return Array.isArray(data.recent) ? data.recent.filter((r) => typeof r?.path === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}

export async function addRecent(profile: string, path: string): Promise<RecentEntry[]> {
  const existing = (await readRecent(profile)).filter((r) => resolve(r.path) !== resolve(path));
  const recent = [{ path: resolve(path), openedAt: new Date().toISOString() }, ...existing].slice(0, 10);
  await mkdir(profile, { recursive: true });
  await atomicWrite(join(profile, "recent.json"), JSON.stringify({ recent }, null, 2) + "\n");
  return recent;
}
