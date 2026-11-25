// Appearance preference (run 6, .kiro/specs/appearance, requirements 2 and 3).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Appearance, appearanceFromText, DEFAULT_APPEARANCE, effectiveTheme } from "@nexus/schema";
import { client, fakeWebDist, openSession, startService, type RunningService } from "../test/harness";
import { injectAppearance, readAppearance, writeAppearance } from "./appearance";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "nexus-appearance-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("the appearance preference", () => {
  it("accepts each mode with a light and a dark palette, and nothing else", () => {
    for (const mode of ["light", "dark", "system"] as const) {
      expect(Appearance.safeParse({ schemaVersion: 1, mode, light: "linen", dark: "plum" }).success).toBe(true);
    }
    expect(Appearance.safeParse({ schemaVersion: 1, mode: "system", light: "graphite", dark: "plum" }).success).toBe(false); // a dark palette in the light slot
    expect(Appearance.safeParse({ schemaVersion: 1, mode: "system", light: "linen", dark: "porcelain" }).success).toBe(false);
    expect(Appearance.safeParse({ schemaVersion: 1, mode: "sepia", light: "linen", dark: "plum" }).success).toBe(false);
    expect(Appearance.safeParse({ ...DEFAULT_APPEARANCE, accent: "#ff0000" }).success).toBe(false); // strict: no extra keys
    expect(Appearance.safeParse({ ...DEFAULT_APPEARANCE, schemaVersion: 2 }).success).toBe(false);
  });

  it("starts by matching the system, with the approved light look and the graphite dark one", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ schemaVersion: 1, mode: "system", light: "porcelain", dark: "graphite" });
  });

  it("shows the system's theme only in Match system", () => {
    expect(effectiveTheme({ mode: "system" }, true)).toBe("dark");
    expect(effectiveTheme({ mode: "system" }, false)).toBe("light");
    expect(effectiveTheme({ mode: "light" }, true)).toBe("light");
    expect(effectiveTheme({ mode: "dark" }, false)).toBe("dark");
  });

  it("falls back to the default when the file is missing, damaged or invalid, and round-trips a valid one", async () => {
    expect(await readAppearance(dir)).toEqual(DEFAULT_APPEARANCE);
    await writeFile(join(dir, "appearance.json"), "{ not json");
    expect(await readAppearance(dir)).toEqual(DEFAULT_APPEARANCE);
    await writeFile(join(dir, "appearance.json"), JSON.stringify({ schemaVersion: 1, mode: "dark", light: "linen", dark: "neon" }));
    expect(await readAppearance(dir)).toEqual(DEFAULT_APPEARANCE);
    const chosen = { schemaVersion: 1, mode: "dark", light: "mist", dark: "midnight" } as const;
    await writeAppearance(dir, chosen);
    expect(await readAppearance(dir)).toEqual(chosen);
    expect(await readFile(join(dir, "appearance.json"), "utf8")).toBe(JSON.stringify(chosen, null, 2) + "\n");
  });

  it("reads every invalid stored shape as the default, the same way for the service and the desktop app (R6-11)", async () => {
    const invalid = [
      "null", "[]", '["dark"]', '"dark"', "42", "true", "{}", "", "{ not json",
      JSON.stringify({ schemaVersion: 1, mode: null, light: "linen", dark: "plum" }),
      JSON.stringify({ schemaVersion: 1, mode: "dark", light: 7, dark: "plum" }),
      JSON.stringify({ schemaVersion: "1", mode: "dark", light: "linen", dark: "plum" }),
      JSON.stringify({ schemaVersion: 1, mode: "dark", light: "linen", dark: "neon" }),
      JSON.stringify({ schemaVersion: 1, mode: "dark", light: "graphite", dark: "plum" }),
      JSON.stringify({ schemaVersion: 1, mode: "dark", light: "linen" }),
    ];
    for (const text of invalid) {
      // appearanceFromText is what Electron main uses to choose the window's background.
      expect(appearanceFromText(text), text).toEqual(DEFAULT_APPEARANCE);
      await writeFile(join(dir, "appearance.json"), text);
      expect(await readAppearance(dir), text).toEqual(DEFAULT_APPEARANCE);
    }
    expect(appearanceFromText(null)).toEqual(DEFAULT_APPEARANCE); // a missing or unreadable file
    const chosen = { schemaVersion: 1, mode: "dark", light: "mist", dark: "plum" } as const;
    expect(appearanceFromText(JSON.stringify(chosen))).toEqual(chosen);
    // A file that cannot be read at all (here a folder in its place) gives the default too.
    await rm(join(dir, "appearance.json"));
    await mkdir(join(dir, "appearance.json"));
    expect(await readAppearance(dir)).toEqual(DEFAULT_APPEARANCE);
  });

  it("writes the preference into the html tag, replacing an earlier one and keeping other attributes", () => {
    const shell = '<!doctype html><html lang="en-GB"><head></head><body></body></html>';
    const once = injectAppearance(shell, { schemaVersion: 1, mode: "dark", light: "linen", dark: "plum" });
    expect(once).toContain('<html lang="en-GB" data-mode="dark" data-light="linen" data-dark="plum">');
    const twice = injectAppearance(once, DEFAULT_APPEARANCE);
    expect(twice).toContain('<html lang="en-GB" data-mode="system" data-light="porcelain" data-dark="graphite">');
    expect(twice.match(/data-mode=/g)).toHaveLength(1);
    expect(injectAppearance("<!doctype html><HTML><body></body></HTML>", DEFAULT_APPEARANCE)).toContain('<html data-mode="system"');
  });
});

/** Collects the `appearance.changed` events one session receives, in the order they arrive. */
async function appearanceEvents(svc: RunningService, token: string) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${svc.port}/api/v1/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const seen: unknown[] = [];
  let buffer = "";
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const data = buffer.slice(0, end).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
          buffer = buffer.slice(end + 2);
          if (!data) continue;
          const event = JSON.parse(data) as { type: string; appearance?: unknown };
          if (event.type === "appearance.changed") seen.push(event.appearance);
        }
      }
    } catch { /* the stream was closed */ }
  })();
  return { seen, stop: async () => { controller.abort(); await pump; } };
}

describe("the appearance routes and the app shell", () => {
  let svc: RunningService | null = null;
  afterEach(async () => { await svc?.stop(); svc = null; });

  it("keeps both of two overlapping choices from two sessions, and publishes each merged value in order (R6-12)", async () => {
    const profile = join(dir, "profile");
    // Every save waits between reading the stored preference and writing it, to widen the race.
    svc = await startService({ profile, env: { NEXUS_FAULT_DELAY: "appearance:before-save:800" } });
    const tokenA = await openSession(svc);
    const a = client(svc, tokenA);
    const b = client(svc, await openSession(svc));
    const events = await appearanceEvents(svc, tokenA);
    try {
      const first = a.patch("/appearance", { light: "linen" }); // session A: Linen for light, slow to save
      await new Promise((r) => setTimeout(r, 300)); // A has read the old preference and is still saving
      const second = b.patch("/appearance", { dark: "plum" }); // session B: Plum for dark, meanwhile
      const [ra, rb] = await Promise.all([first, second]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      const both = { schemaVersion: 1, mode: "system", light: "linen", dark: "plum" };
      expect(JSON.parse(await readFile(join(profile, "appearance.json"), "utf8"))).toEqual(both);
      expect(ra.body.appearance).toEqual({ ...both, dark: "graphite", revision: 1 });
      expect(rb.body.appearance).toEqual({ ...both, revision: 2 });
      expect((await b.get("/appearance")).body).toEqual({ appearance: { ...both, revision: 2 } });
      await expect.poll(() => events.seen.length).toBe(2);
      expect(events.seen).toEqual([{ ...both, dark: "graphite", revision: 1 }, { ...both, revision: 2 }]);
    } finally {
      await events.stop();
    }
  });

  it("needs a session, takes only the changed fields, stores the merged preference in the profile and serves it in the shell on a new port", async () => {
    const profile = join(dir, "profile");
    const webDist = await fakeWebDist(join(dir, "web"));
    await writeFile(join(webDist, "index.html"), '<!doctype html><html lang="en-GB"><head><title>Nexus</title></head><body><div id="root"></div></body></html>');
    svc = await startService({ profile, webDist });
    expect((await fetch(`http://127.0.0.1:${svc.port}/api/v1/appearance`)).status).toBe(401);
    const unauthenticated = await fetch(`http://127.0.0.1:${svc.port}/api/v1/appearance`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "dark" }) });
    expect(unauthenticated.status).toBe(401);
    const api = client(svc, await openSession(svc));
    expect((await api.get("/appearance")).body).toEqual({ appearance: { ...DEFAULT_APPEARANCE, revision: 0 } });
    for (const body of [{}, null, [], { light: "plum" }, { dark: "linen" }, { mode: "sepia" }, { mode: "dark", accent: "#ff0000" }, { schemaVersion: 1, mode: "dark" }, { ...DEFAULT_APPEARANCE }]) {
      expect((await api.patch("/appearance", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(JSON.parse(await readFile(join(profile, "appearance.json"), "utf8").catch(() => "null"))).toBeNull();
    // Whole-object saves are gone: a stale copy can no longer overwrite another session's choice.
    expect((await api.put("/appearance", { schemaVersion: 1, mode: "dark", light: "mist", dark: "plum" })).status).toBe(404);
    expect((await api.patch("/appearance", { mode: "dark" })).body).toEqual({ appearance: { ...DEFAULT_APPEARANCE, mode: "dark", revision: 1 } });
    expect((await api.patch("/appearance", { light: "mist", dark: "plum" })).body).toEqual({ appearance: { schemaVersion: 1, mode: "dark", light: "mist", dark: "plum", revision: 2 } });
    const chosen = { schemaVersion: 1, mode: "dark", light: "mist", dark: "plum" };
    expect(JSON.parse(await readFile(join(profile, "appearance.json"), "utf8"))).toEqual(chosen);
    await svc.stop();

    svc = await startService({ profile, webDist }); // a fresh free port: the preference is keyed by profile, not origin
    for (const path of ["/", "/settings", "/issues/NEX-1"]) {
      const res = await fetch(`http://127.0.0.1:${svc.port}${path}`);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.text();
      expect(body, path).toContain('<html lang="en-GB" data-mode="dark" data-light="mist" data-dark="plum">');
      expect(body).not.toMatch(/token|launch|controlSecret/i);
    }
  });
});
