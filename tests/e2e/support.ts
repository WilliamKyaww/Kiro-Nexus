// E2E support: run the built service with an isolated profile and temp workspace.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

export interface Service { port: number; profile: string; child: ChildProcess; stop: () => Promise<void> }

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function startService(profile: string, workspace?: string, extraArgs: string[] = [], env: Record<string, string> = {}): Promise<Service> {
  const args = [resolve("server/dist/main.mjs"), "--profile", profile, ...extraArgs];
  if (workspace) args.push("--workspace", workspace);
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d; });
  const port = await new Promise<number>((res, rej) => {
    createInterface({ input: child.stdout! }).on("line", (line) => {
      try { const m = JSON.parse(line); if (m.event === "ready") res(m.port); } catch { /* ignore */ }
    });
    child.once("exit", (c) => rej(new Error(`service exited ${c}: ${stderr}`)));
    setTimeout(() => rej(new Error(`service start timeout: ${stderr}`)), 20_000);
  });
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  return {
    port,
    profile,
    child,
    stop: async () => {
      const info = JSON.parse(await readFile(join(profile, "service.json"), "utf8"));
      await fetch(`http://127.0.0.1:${port}/api/v1/shutdown`, { method: "POST", headers: { authorization: `Bearer ${info.controlSecret}` } }).catch(() => undefined);
      const t = setTimeout(() => child.kill(), 8000);
      await exited;
      clearTimeout(t);
    },
  };
}

export async function launchUrl(svc: Service): Promise<string> {
  const info = JSON.parse(await readFile(join(svc.profile, "service.json"), "utf8"));
  const res = await fetch(`http://127.0.0.1:${svc.port}/api/v1/launch-codes`, { method: "POST", headers: { authorization: `Bearer ${info.controlSecret}` } });
  const { launchCode } = await res.json();
  return `http://127.0.0.1:${svc.port}/#launch=${launchCode}`;
}

/** A Node-side API client for test setup (synthetic data only). */
export async function apiSession(svc: Service) {
  const url = new URL(await launchUrl(svc));
  const code = new URLSearchParams(url.hash.slice(1)).get("launch");
  const res = await fetch(`http://127.0.0.1:${svc.port}/api/v1/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ launchCode: code }) });
  const { token } = await res.json();
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${svc.port}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
}
