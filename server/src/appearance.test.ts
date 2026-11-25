// Appearance preference (run 6, .kiro/specs/appearance, requirements 2 and 3).
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Appearance, DEFAULT_APPEARANCE, effectiveTheme } from "@nexus/schema";
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

describe("the appearance routes and the app shell", () => {
  let svc: RunningService | null = null;
  afterEach(async () => { await svc?.stop(); svc = null; });

  it("needs a session, validates the body, stores it in the profile and serves it in the shell on a new port", async () => {
    const profile = join(dir, "profile");
    const webDist = await fakeWebDist(join(dir, "web"));
    await writeFile(join(webDist, "index.html"), '<!doctype html><html lang="en-GB"><head><title>Nexus</title></head><body><div id="root"></div></body></html>');
    svc = await startService({ profile, webDist });
    expect((await fetch(`http://127.0.0.1:${svc.port}/api/v1/appearance`)).status).toBe(401);
    const api = client(svc, await openSession(svc));
    expect((await api.get("/appearance")).body).toEqual({ appearance: DEFAULT_APPEARANCE });
    const bad = await api.put("/appearance", { schemaVersion: 1, mode: "dark", light: "plum", dark: "plum" });
    expect(bad.status).toBe(400);
    expect(JSON.parse(await readFile(join(profile, "appearance.json"), "utf8").catch(() => "null"))).toBeNull();
    const chosen = { schemaVersion: 1, mode: "dark", light: "mist", dark: "plum" };
    expect((await api.put("/appearance", chosen)).body).toEqual({ appearance: chosen });
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
