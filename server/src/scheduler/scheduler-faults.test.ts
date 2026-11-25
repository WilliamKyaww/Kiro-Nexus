// Repairs from Astra 6.2's run-5 review (R5-4, R5-5, R5-6, R5-13), in-process with the test
// clock, on a disposable copy of the fictional sample. Each case was first run against the code
// at 0c641a1 and failed there. Every check of the log reads the file on disk.
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeliveryLog, type Delivery } from "@nexus/schema";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace, newId } from "../workspace/service";
import { Scheduler, TestClock } from "./scheduler";

let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let scheduler: Scheduler;
let shown: Delivery[];
let logs: string[];
let n = 0;
const clock = new TestClock(new Date("2026-12-01T08:00:00.000Z"));
const stateFile = (name: string) => join(ws, ".nexus", "state", name);
const logOnDisk = async () => DeliveryLog.parse(JSON.parse(await readFile(stateFile("deliveries.json"), "utf8")));
const NEX1 = "iss_01KAR5Y3S2M8Q4K7Y2C9X5V6B3";
const E_BAD = "evt_01KAR5Y3S2M8Q4K7Y2C9X5V6E7";
const E_GOOD = "evt_01KAR5Y3S2M8Q4K7Y2C9X5V6E8";

async function open(at: string, intervalMs = 0) {
  clock.set(new Date(at));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `faults-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
  scheduler = new Scheduler(service, engine, (d) => shown.push(d), (line) => logs.push(line), clock);
  return scheduler.start(intervalMs);
}
async function close() { await scheduler.stop(); await service.close(); }
const tickAt = async (at: string) => { clock.set(new Date(at)); return scheduler.tick(); };
const writeCalendar = (events: unknown[]) => writeFile(join(ws, ".nexus", "calendar.json"), JSON.stringify({ schemaVersion: 1, events }));
const until = async (check: () => Promise<boolean> | boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-sched-faults-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  shown = [];
  logs = [];
  await open("2026-12-01T08:00:00.000Z"); // first start: lastTickAt = 08:00 on 1 December
});
afterEach(async () => { await close().catch(() => undefined); await rm(base, { recursive: true, force: true }); });

describe("R5-4: one bad record does not stop the others", () => {
  it("skips an event and an issue whose zones do not exist, reports them, and still delivers NEX-1 and a valid event", async () => {
    await writeCalendar([
      { id: E_BAD, title: "Fictional offsite", start: { dateTime: "2026-12-09T10:00:00.000Z", timeZone: "Europe/Londn" } }, // days later
      { id: E_GOOD, title: "Fictional rehearsal", start: { dateTime: "2026-12-05T10:00:00.000Z", timeZone: "Europe/London" } },
    ]);
    // issues.json accepts any zone string, so the scheduler must isolate a bad issue as well.
    const odd = await service.createIssue({ projectId: service.listProjects()[0]!.id, title: "Fictional task on Mars time", due: { dateTime: "2026-12-07T12:00:00.000Z", timeZone: "Mars/Olympus" } });
    const delivered = await tickAt("2026-12-05T09:00:30.000Z"); // NEX-1 at 09:00, the rehearsal 60 min before 10:00
    expect(delivered.map((d) => d.targetId).sort()).toEqual([E_GOOD, NEX1].sort());
    expect(shown).toHaveLength(2);
    const problems = await scheduler.problems();
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: ".nexus/calendar.json", record: E_BAD, message: expect.stringContaining("Europe/Londn") }),
      expect.objectContaining({ file: ".nexus/issues.json", record: odd.key, message: expect.stringContaining("Mars/Olympus") }),
    ]));
    expect(problems).toHaveLength(2);
    expect(logs.filter((l) => l.includes(E_BAD))).toHaveLength(1); // named once in the log, not on every tick
    await tickAt("2026-12-05T09:05:00.000Z");
    expect(logs.filter((l) => l.includes(E_BAD))).toHaveLength(1);
    expect(logs.join("\n")).not.toContain("Fictional offsite"); // titles are content, not log material
  });
});

describe("R5-5: a damaged delivery log is never taken for a new one", () => {
  it("treats a zero-byte log as damaged: nothing is delivered, the test reminder is refused and the file is left alone", async () => {
    await close();
    await writeFile(stateFile("deliveries.json"), "");
    await expect(open("2026-12-05T08:30:00.000Z")).rejects.toMatchObject({ code: "INVALID_DATA" });
    await expect(scheduler.test()).rejects.toMatchObject({ code: "INVALID_DATA", details: { file: ".nexus/state/deliveries.json", recovery: "replace-delivery-log" } });
    await expect(tickAt("2026-12-05T09:00:30.000Z")).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(shown).toEqual([]);
    expect(await readFile(stateFile("deliveries.json"), "utf8")).toBe("");
  });

  it("treats a read error as damage, not as a missing file", async () => {
    await mkdir(stateFile("deliveries.json")); // a folder where the log should be: reading it fails with EISDIR
    await expect(scheduler.readLog()).rejects.toMatchObject({ code: "INVALID_DATA", details: { file: ".nexus/state/deliveries.json" } });
    await expect(scheduler.test()).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(shown).toEqual([]);
  });

  it("after a failed start, a repaired log brings periodic ticks back without reopening the workspace", async () => {
    await close();
    await writeFile(stateFile("deliveries.json"), "{ not json");
    await expect(open("2026-12-05T08:30:00.000Z", 20)).rejects.toThrow(/deliveries\.json/); // ticks every 20 ms
    await new Promise((r) => setTimeout(r, 120)); // several ticks fail while the file is damaged
    expect(shown).toEqual([]);
    // Fixed by hand, in one step: a plain write truncates first, and a tick could read the empty
    // file in between (a different cause, which is logged once more).
    await writeFile(stateFile("deliveries.json.repair"), JSON.stringify({ schemaVersion: 1, seenUpTo: null, deliveries: [] }));
    // On Windows a rename over a file that a tick is reading fails with EPERM for a moment;
    // the product's atomic write retries, so the hand repair does too.
    for (let attempt = 0; ; attempt++) {
      try { await rename(stateFile("deliveries.json.repair"), stateFile("deliveries.json")); break; } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EPERM" || attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    // The next periodic tick finishes the start-up first: the boundary moves to 08:30.
    expect(await until(async () => JSON.parse(await readFile(stateFile("scheduler.json"), "utf8")).lastTickAt === "2026-12-05T08:30:00.000Z")).toBe(true);
    clock.set(new Date("2026-12-05T09:00:30.000Z"));
    expect(await until(() => shown.length > 0)).toBe(true);
    expect(shown).toEqual([expect.objectContaining({ targetId: NEX1, status: "delivered" })]);
    expect(logs.filter((l) => l.includes("deliveries.json"))).toHaveLength(1); // reported once, not on every failed tick
  });

  it("replaces a damaged log only on request, keeps a copy, and never repeats what came before", async () => {
    await close();
    await writeFile(stateFile("deliveries.json"), "");
    await expect(open("2026-12-05T09:30:00.000Z")).rejects.toMatchObject({ code: "INVALID_DATA" }); // NEX-1's 09:00 is in the gap
    const { keptAs } = await scheduler.replaceDamagedLog();
    expect(keptAs).toMatch(/^\.nexus\/state\/deliveries\.damaged-[0-9TZ-]+\.json$/);
    expect(await readFile(join(ws, ...keptAs.split("/")), "utf8")).toBe(""); // the damaged bytes, kept
    const log = await logOnDisk();
    expect(log).toMatchObject({ deliveries: [], prunedUpTo: "2026-12-05T09:30:00.000Z" });
    await expect(scheduler.replaceDamagedLog()).rejects.toMatchObject({ code: "CONFLICT" }); // a valid log is never replaced
    expect(await tickAt("2026-12-05T09:31:00.000Z")).toEqual([]);
    expect(shown).toEqual([]);
    expect((await scheduler.test()).kind).toBe("test"); // the test reminder works again
  });
});

describe("R5-6: one occurrence, one delivery", () => {
  it("delivers two rows with the same event ID and instant once, and reports the repeat", async () => {
    const row = { id: E_GOOD, title: "Fictional rehearsal", start: { dateTime: "2026-12-02T15:00:00.000Z", timeZone: "Europe/London" } };
    await writeCalendar([row, { ...row }]);
    expect(await tickAt("2026-12-02T14:00:10.000Z")).toHaveLength(1);
    expect(shown).toHaveLength(1);
    const keys = (await logOnDisk()).deliveries.map((d) => d.key);
    expect(keys).toHaveLength(1);
    expect(await scheduler.problems()).toEqual([expect.objectContaining({ file: ".nexus/calendar.json", record: E_GOOD, message: expect.stringContaining("same ID") })]);
  });

  it("does not deliver a pruned occurrence again when the clock goes back before it", async () => {
    await close();
    const key = `issue:${NEX1}:allday-0900:2026-12-05T09:00:00.000Z`;
    const delivery = (over: Partial<Delivery>): Delivery => ({
      id: newId("dlv"), key: `test:${newId("tst")}`, kind: "test", targetId: null, targetKey: null, title: "Test reminder", detail: "A test.",
      workspaceId: service.manifest.workspaceId, rule: "test", scheduledAt: "2027-02-01T10:00:00.000Z", status: "delivered", deliveredAt: "2027-02-01T10:00:00.000Z", batch: null, ...over,
    });
    // NEX-1's reminder was delivered on 5 December; 500 fictional test entries came after it.
    const seeded = [delivery({ key, kind: "issue", targetId: NEX1, targetKey: "NEX-1", title: "Build calendar view", detail: "Due today", rule: "allday-0900", scheduledAt: "2026-12-05T09:00:00.000Z", deliveredAt: "2026-12-05T09:00:05.000Z" })];
    for (let i = 0; i < 500; i++) seeded.push(delivery({ scheduledAt: new Date(Date.UTC(2027, 1, 1, 10, i)).toISOString(), deliveredAt: new Date(Date.UTC(2027, 1, 1, 10, i)).toISOString() }));
    await writeFile(stateFile("deliveries.json"), JSON.stringify({ schemaVersion: 1, seenUpTo: null, deliveries: seeded }));
    await open("2027-02-10T12:00:00.000Z");
    await scheduler.test(); // 502 entries: NEX-1's, older than 60 days, is pruned
    expect((await logOnDisk()).deliveries.some((d) => d.key === key)).toBe(false);
    await close();
    await open("2026-12-05T08:00:00.000Z"); // the clock is put back before 09:00 on 5 December
    expect(await tickAt("2026-12-05T09:00:30.000Z")).toEqual([]);
    expect(shown.filter((d) => d.kind === "issue")).toEqual([]);
  });
});

describe("R5-13: a stopped scheduler delivers nothing", () => {
  it("drops a tick that was reading the event file when the scheduler stopped, and leaves no delivered entry", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let reading!: () => void;
    const started = new Promise<void>((r) => { reading = r; });
    const read = service.readDataFile.bind(service);
    service.readDataFile = async (name) => { if (name === "calendar.json") { reading(); await gate; } return read(name); };
    clock.set(new Date("2026-12-05T09:00:30.000Z"));
    const pending = scheduler.tick();
    await started; // the tick is waiting on calendar.json
    const stopped = scheduler.stop();
    release();
    expect(await pending).toEqual([]);
    await stopped;
    expect(shown).toEqual([]);
    const names = await readdir(join(ws, ".nexus", "state"));
    if (names.includes("deliveries.json")) expect((await logOnDisk()).deliveries.filter((d) => d.status === "delivered")).toEqual([]);
    // It was never shown, so the next start lists it once as missed.
    await service.close();
    expect(await open("2026-12-05T09:05:00.000Z")).toBe(1);
    expect(shown).toEqual([]);
  });

  it("does not show the test reminder from a stopped scheduler", async () => {
    void scheduler.stop();
    await expect(scheduler.test()).rejects.toMatchObject({ code: "NO_WORKSPACE" });
    expect(shown).toEqual([]);
  });
});
