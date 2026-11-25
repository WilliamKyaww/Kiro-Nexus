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

/**
 * Runs in the page (pass it to `page.evaluate`), so it uses nothing from this module. For each
 * palette it sets the pair on <html>, reads the scrollbar colour that a scrolling element
 * actually gets, and measures the thumb against each background token at 3:1 (WCAG 1.4.11).
 * The track is transparent, so the thumb sits on the element's own background (R6-17).
 */
export function thumbFailures(backgrounds: string[]): string[] {
  const probe = document.createElement("canvas").getContext("2d")!;
  const rgb = (v: string) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = "#000"; probe.fillStyle = v.trim(); probe.fillRect(0, 0, 1, 1); const d = probe.getImageData(0, 0, 1, 1).data; return [d[0]! / 255, d[1]! / 255, d[2]! / 255]; };
  const lum = (c: number[]) => { const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!; };
  // The first colour of "<thumb> <track>"; a colour can contain spaces inside its brackets.
  const firstColour = (v: string) => { let depth = 0; for (let i = 0; i < v.length; i++) { if (v[i] === "(") depth++; else if (v[i] === ")") depth--; else if (v[i] === " " && depth === 0) return v.slice(0, i); } return v; };
  const root = document.documentElement;
  const saved = { theme: root.dataset.theme, palette: root.dataset.palette };
  const box = document.createElement("div");
  box.style.overflow = "auto";
  document.body.append(box);
  const out: string[] = [];
  for (const [theme, palette] of [["light", "porcelain"], ["light", "linen"], ["light", "mist"], ["dark", "graphite"], ["dark", "midnight"], ["dark", "plum"]]) {
    root.dataset.theme = theme; root.dataset.palette = palette;
    const value = getComputedStyle(box).scrollbarColor.trim();
    if (!value || value === "auto") { out.push(`${palette}: the scrollbar colour is ${value || "unset"}`); continue; }
    const thumb = firstColour(value);
    const s = getComputedStyle(root);
    for (const bg of backgrounds) {
      const [x, y] = [lum(rgb(thumb)), lum(rgb(s.getPropertyValue(`--${bg}`)))].sort((m, n) => n - m);
      const ratio = (x! + 0.05) / (y! + 0.05);
      if (ratio < 3) out.push(`${palette}: the thumb ${thumb} on ${bg} is ${ratio.toFixed(2)}:1, needs 3:1`);
    }
  }
  box.remove();
  if (saved.theme === undefined) delete root.dataset.theme; else root.dataset.theme = saved.theme;
  if (saved.palette === undefined) delete root.dataset.palette; else root.dataset.palette = saved.palette;
  return out;
}
