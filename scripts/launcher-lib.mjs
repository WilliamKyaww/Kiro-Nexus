// Shared helpers for the launch, open and desktop scripts.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const tryRoot = resolve(repoRoot, ".tmp", "try");
export const tryPaths = {
  workspace: join(tryRoot, "workspace"),
  profile: join(tryRoot, "profile"),
  desktopProfile: join(tryRoot, "desktop-profile"),
};
export const TRY_PORT = 47100;

export function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function defaultProfile() {
  if (process.env.NEXUS_PROFILE_DIR) return resolve(process.env.NEXUS_PROFILE_DIR);
  return join(process.env.APPDATA ?? join(homedir(), ".config"), "Nexus");
}

export async function readServiceFile(profile) {
  try {
    return JSON.parse(await readFile(join(profile, "service.json"), "utf8"));
  } catch {
    return null;
  }
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** Ask the running service for a single-use launch URL (control secret from the profile). */
export async function launchUrl(profile) {
  const info = await readServiceFile(profile);
  if (!info || !isAlive(info.pid)) return null;
  const res = await fetch(`http://127.0.0.1:${info.port}/api/v1/launch-codes`, {
    method: "POST",
    headers: { authorization: `Bearer ${info.controlSecret}` },
  }).catch(() => null);
  if (!res?.ok) return null;
  const { launchCode } = await res.json();
  return `http://127.0.0.1:${info.port}/#launch=${launchCode}`;
}

export function openInBrowser(url) {
  const [cmd, args] = process.platform === "win32"
    ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.log(`Could not open a browser automatically. Open this link within 2 minutes:\n  ${url}`));
  child.unref();
}
