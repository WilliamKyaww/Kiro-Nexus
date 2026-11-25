// R5-13 (Astra 6.2's run-5 review): a reminder from a workspace that is closing is never
// published, in particular not once another workspace is open. This runs the real service
// state (AppState, the review hooks and the reminder hooks) in-process, with the test clock,
// on two disposable copies of the fictional sample.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Delivery } from "@nexus/schema";
import type { AppState as AppStateT, ServerEvent } from "../state";
import { copySampleWorkspace } from "../workspace/service";
import type { TestClock } from "./scheduler";

// The reminder module reads NEXUS_TEST_CLOCK when it loads, so it is imported after setting it.
process.env.NEXUS_TEST_CLOCK = "2026-12-05T08:00:00.000Z";
const { AppState } = await import("../state");
const { installReview } = await import("../review");
const reminders = await import("./index");
delete process.env.NEXUS_TEST_CLOCK;
const clock = reminders.clock as TestClock;

let base: string;
beforeAll(async () => { base = await mkdtemp(join(tmpdir(), "nexus-sched-boundary-")); });
afterAll(async () => { await rm(base, { recursive: true, force: true }); });

async function setUp(name: string) {
  const a = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, name, "a"));
  const b = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, name, "b"));
  const state: AppStateT = new AppState(join(base, name, "profile"), `boundary-${name}`, null, () => undefined);
  installReview(state);
  reminders.installReminders(state);
  const published: ServerEvent[] = [];
  state.bus.on("event", (e: ServerEvent) => { if (e.type === "notification") published.push(e); });
  return { a, b, state, published };
}

describe("R5-13: reminders stop at the workspace boundary", () => {
  it("a tick paused on calendar.json while the workspace closes publishes nothing, before or after the next one opens", async () => {
    const { a, b, state, published } = await setUp("paused");
    clock.set(new Date("2026-12-05T08:00:00.000Z"));
    await state.open(a);
    const old = reminders.requireScheduler(state);
    const serviceA = state.service!;
    const idA = serviceA.manifest.workspaceId;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let reading!: () => void;
    const started = new Promise<void>((r) => { reading = r; });
    const read = serviceA.readDataFile.bind(serviceA);
    serviceA.readDataFile = async (name) => { if (name === "calendar.json") { reading(); await gate; } return read(name); };
    // The read is let go as the close begins, so it completes while the old scheduler is stopping.
    state.onClose.unshift(async () => { release(); });
    clock.set(new Date("2026-12-05T09:00:30.000Z")); // NEX-1 in workspace A is due at 09:00
    const pending = old.tick();
    await started;
    await state.open(b);
    expect(await pending).toEqual([]);
    await new Promise((r) => setTimeout(r, 200)); // time for any late publish (the old code reread the settings first)
    expect(published).toEqual([]);
    expect(state.service!.manifest.workspaceId).not.toBe(idA);
    await state.closeWorkspace();
  });

  it("an old workspace's reminder is never published after another workspace has opened", async () => {
    const { a, b, state } = await setUp("late");
    clock.set(new Date("2026-12-05T08:00:00.000Z"));
    await state.open(a);
    const old = reminders.requireScheduler(state);
    const serviceA = state.service!;
    const idA = serviceA.manifest.workspaceId;
    let phase: "a-open" | "b-open" = "a-open";
    const seen: Array<{ phase: string; workspaceId: string }> = [];
    state.bus.on("event", (e: ServerEvent) => { if (e.type === "notification") seen.push({ phase, workspaceId: (e.delivery as Delivery).workspaceId }); });
    // Hold any second read of reminders.json: the old delivery callback reread the settings before publishing.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let reads = 0;
    const read = serviceA.readDataFile.bind(serviceA);
    serviceA.readDataFile = async (name) => { if (name === "reminders.json" && ++reads === 2) await gate; return read(name); };
    clock.set(new Date("2026-12-05T09:00:30.000Z"));
    expect(await old.tick()).toEqual([expect.objectContaining({ targetKey: "NEX-1", workspaceId: idA })]);
    await state.open(b);
    phase = "b-open";
    release();
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.filter((s) => s.phase === "b-open")).toEqual([]);
    expect(seen).toEqual([{ phase: "a-open", workspaceId: idA }]); // published once, while A was the open workspace
    await state.closeWorkspace();
  });

  it("publishes only for the active scheduler of the open workspace", async () => {
    const { a, b, state, published } = await setUp("guard");
    clock.set(new Date("2026-12-05T08:00:00.000Z"));
    await state.open(a);
    const old = reminders.requireScheduler(state);
    const settings = await old.settings();
    const delivery = { id: "dlv_01KAR5Y3S2M8Q4K7Y2C9X5V6D1", workspaceId: old.service.manifest.workspaceId } as Delivery;
    reminders.publishDelivery(state, old, delivery, settings);
    expect(published).toHaveLength(1); // the open workspace's own scheduler
    await state.open(b);
    reminders.publishDelivery(state, old, delivery, settings); // A's scheduler, after B opened
    expect(published).toHaveLength(1);
    await state.closeWorkspace();
  });
});
