// Test harness: run the built service as a real child process with an isolated profile.
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

export const serverBundle = resolve("server/dist/main.mjs");

export interface RunningService {
  port: number;
  pid: number;
  controlSecret: string;
  child: ChildProcess;
  stderr: () => string;
  exited: Promise<number | null>;
  stop: () => Promise<number | null>;
}

export async function fakeWebDist(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Nexus</title><div id=root></div>");
  return dir;
}

export async function startService(opts: { profile: string; workspace?: string; port?: number; webDist?: string; env?: Record<string, string> }): Promise<RunningService> {
  const args = [serverBundle, "--profile", opts.profile];
  if (opts.workspace) args.push("--workspace", opts.workspace);
  if (opts.port) args.push("--port", String(opts.port));
  if (opts.webDist) args.push("--web-dist", opts.webDist);
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...opts.env } });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d; });
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  const ready = await new Promise<{ port: number; pid: number } | { error: string }>((resolveReady) => {
    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.event === "ready") resolveReady({ port: msg.port, pid: msg.pid });
        if (msg.event === "error") resolveReady({ error: msg.code });
      } catch { /* not JSON */ }
    });
    void exited.then((code) => resolveReady({ error: `exited ${code}: ${stderr}` }));
    setTimeout(() => resolveReady({ error: `timeout: ${stderr}` }), 20_000);
  });
  if ("error" in ready) throw new Error(`service did not start: ${ready.error}`);
  const serviceFile = JSON.parse(await readFile(join(opts.profile, "service.json"), "utf8"));
  const svc: RunningService = {
    port: ready.port,
    pid: ready.pid,
    controlSecret: serviceFile.controlSecret,
    child,
    stderr: () => stderr,
    exited,
    stop: async () => {
      await fetch(`http://127.0.0.1:${ready.port}/api/v1/shutdown`, { method: "POST", headers: { authorization: `Bearer ${serviceFile.controlSecret}` } }).catch(() => undefined);
      const timer = setTimeout(() => child.kill(), 10_000);
      const code = await exited;
      clearTimeout(timer);
      return code;
    },
  };
  return svc;
}

export async function mintLaunchCode(svc: RunningService): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${svc.port}/api/v1/launch-codes`, { method: "POST", headers: { authorization: `Bearer ${svc.controlSecret}` } });
  if (!res.ok) throw new Error(`launch code: ${res.status}`);
  return (await res.json()).launchCode;
}

export async function openSession(svc: RunningService): Promise<string> {
  const code = await mintLaunchCode(svc);
  const res = await fetch(`http://127.0.0.1:${svc.port}/api/v1/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ launchCode: code }) });
  if (!res.ok) throw new Error(`session: ${res.status}`);
  return (await res.json()).token;
}

export function client(svc: RunningService, token: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${svc.port}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return {
    get: (p: string) => call("GET", p),
    post: (p: string, b?: unknown) => call("POST", p, b ?? {}),
    put: (p: string, b: unknown) => call("PUT", p, b),
    patch: (p: string, b: unknown) => call("PATCH", p, b),
  };
}

/** Raw HTTP request with an arbitrary Host header (fetch forbids overriding it). */
export function rawRequest(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolveReq, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolveReq({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
