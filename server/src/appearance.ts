// Appearance preference of the local profile (run 6, PRD-081, DEC-028). It lives in the
// profile, so it is the same for the browser and desktop routes and survives a new port.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { Appearance, DEFAULT_APPEARANCE, serialise } from "@nexus/schema";
import type { RouteContext } from "./app";
import type { AppState } from "./state";
import { atomicWrite } from "./workspace/atomic";

const fileOf = (profileDir: string) => join(profileDir, "appearance.json");

/** The stored preference, or the default when there is none or it cannot be read. */
export async function readAppearance(profileDir: string): Promise<Appearance> {
  try {
    const parsed = Appearance.safeParse(JSON.parse(await readFile(fileOf(profileDir), "utf8")));
    return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export async function writeAppearance(profileDir: string, value: Appearance): Promise<void> {
  await atomicWrite(fileOf(profileDir), serialise(Appearance, value));
}

/**
 * The app shell's `<html>` tag with the stored preference as attributes, read by
 * `/theme-boot.js` before the first paint. It holds a UI preference only, never workspace data.
 */
export function injectAppearance(html: string, a: Appearance): string {
  return html.replace(/<html\b([^>]*)>/i, (_m, attrs: string) => {
    const clean = attrs.replace(/\s+data-(mode|light|dark)="[^"]*"/g, "");
    return `<html${clean} data-mode="${a.mode}" data-light="${a.light}" data-dark="${a.dark}">`;
  });
}

export function appearanceRoutes(state: AppState) {
  return (app: FastifyInstance, { parse }: RouteContext) => {
    app.get("/api/v1/appearance", async () => ({ appearance: await readAppearance(state.profileDir) }));
    app.put("/api/v1/appearance", async (request) => {
      const value = parse(Appearance, request.body);
      await writeAppearance(state.profileDir, value);
      state.publish({ type: "appearance.changed", appearance: value });
      return { appearance: value };
    });
  };
}
