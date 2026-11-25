// Appearance preference of the local profile (run 6, PRD-081, DEC-028). It lives in the
// profile, so it is the same for the browser and desktop routes and survives a new port.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { Appearance, AppearancePatch, appearanceFromText, DEFAULT_APPEARANCE, serialise, type AppearanceView } from "@nexus/schema";
import type { RouteContext } from "./app";
import { faultDelay } from "./faults";
import type { AppState } from "./state";
import { atomicWrite } from "./workspace/atomic";

const fileOf = (profileDir: string) => join(profileDir, "appearance.json");

/** The stored preference, or the default when there is none or it cannot be read. */
export async function readAppearance(profileDir: string): Promise<Appearance> {
  try {
    return appearanceFromText(await readFile(fileOf(profileDir), "utf8"));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export async function writeAppearance(profileDir: string, value: Appearance): Promise<void> {
  await atomicWrite(fileOf(profileDir), serialise(Appearance, value));
}

/**
 * Reads and changes of one profile's preference run one at a time, in arrival order, so two
 * overlapping saves never both read the old file (R6-12). `revision` counts the saved changes
 * since this process started; it orders the values that sessions receive and is not stored.
 */
interface ProfileQueue { tail: Promise<void>; revision: number }
const queues = new Map<string, ProfileQueue>();

function queueOf(profileDir: string): ProfileQueue {
  const key = resolve(profileDir);
  let queue = queues.get(key);
  if (!queue) queues.set(key, (queue = { tail: Promise.resolve(), revision: 0 }));
  return queue;
}

function inTurn<T>(queue: ProfileQueue, task: () => Promise<T>): Promise<T> {
  const run = queue.tail.then(task);
  queue.tail = run.then(() => undefined, () => undefined);
  return run;
}

/** The stored preference with the revision it belongs to. */
export function currentAppearance(profileDir: string): Promise<AppearanceView> {
  const queue = queueOf(profileDir);
  return inTurn(queue, async () => ({ ...(await readAppearance(profileDir)), revision: queue.revision }));
}

/**
 * Merges the fields a user changed into the stored preference and saves the result.
 * `saved` runs before the next change starts, so values are published in revision order.
 */
export function updateAppearance(profileDir: string, patch: AppearancePatch, saved?: (value: AppearanceView) => void): Promise<AppearanceView> {
  const queue = queueOf(profileDir);
  return inTurn(queue, async () => {
    const current = await readAppearance(profileDir);
    await faultDelay("appearance:before-save"); // tests widen the read-to-write window here
    const next: Appearance = {
      schemaVersion: 1,
      mode: patch.mode ?? current.mode,
      light: patch.light ?? current.light,
      dark: patch.dark ?? current.dark,
    };
    await writeAppearance(profileDir, next);
    queue.revision += 1;
    const value: AppearanceView = { ...next, revision: queue.revision };
    saved?.(value);
    return value;
  });
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
    app.get("/api/v1/appearance", async () => ({ appearance: await currentAppearance(state.profileDir) }));
    // Field patches only (R6-12): a session sends what the user changed, never a whole copy.
    app.patch("/api/v1/appearance", async (request) => {
      const patch = parse(AppearancePatch, request.body);
      const appearance = await updateAppearance(state.profileDir, patch, (value) => state.publish({ type: "appearance.changed", appearance: value }));
      return { appearance };
    });
  };
}
