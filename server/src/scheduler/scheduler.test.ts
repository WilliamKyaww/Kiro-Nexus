// B4 requirements 1 to 3 with the test clock, in-process, on a disposable copy of the
// fictional sample. Every check reads the delivery log on disk.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeliveryLog, type Delivery } from "@nexus/schema";
import { demoOperations } from "../review/index";
import { ReviewEngine } from "../review/engine";
import { WorkspaceService, copySampleWorkspace } from "../workspace/service";
import { Scheduler, TestClock } from "./scheduler";

let base: string;
let ws: string;
let service: WorkspaceService;
let engine: ReviewEngine;
let scheduler: Scheduler;
let shown: Delivery[];
let n = 0;
const clock = new TestClock(new Date("2026-12-01T08:00:00.000Z"));
const logOnDisk = async () => DeliveryLog.parse(JSON.parse(await readFile(join(ws, ".nexus", "state", "deliveries.json"), "utf8")));

async function open(at: string) {
  clock.set(new Date(at));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `sched-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
  scheduler = new Scheduler(service, engine, (d) => shown.push(d), () => undefined, clock);
  return scheduler.start(0);
}
async function close() { scheduler.stop(); await service.close(); }
const tickAt = async (at: string) => { clock.set(new Date(at)); return scheduler.tick(); };

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-sched-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  shown = [];
  await open("2026-12-01T08:00:00.000Z");
});
afterEach(async () => { await close(); await rm(base, { recursive: true, force: true }); });

describe("the scheduler", () => {
  it("never delivers a date awaiting review, and delivers an accepted date once, however often it ticks", async () => {
    // NEX-1 is due on 5 December (accepted). The fixed demo proposes 3 December.
    const { changes } = await engine.propose({ kind: "fixed-demo", label: "Demo operations (fixed, not AI)" }, await demoOperations(service), "demo");
    expect(await tickAt("2026-12-03T09:30:00.000Z")).toEqual([]); // 09:00 on the proposed date passes
    expect(shown).toEqual([]);
    await engine.accept(changes[1]!.changeId); // now 3 December is accepted, but its 09:00 has passed
    expect(await tickAt("2026-12-03T10:00:00.000Z")).toEqual([]);
    // Move the date to a future day by hand; the reminder follows the manual edit.
    const nex1 = service.listIssues().find((i) => i.key === "NEX-1")!;
    await service.updateIssue("NEX-1", nex1.revision, { due: { date: "2026-12-04" } });
    expect(await tickAt("2026-12-04T08:59:00.000Z")).toEqual([]);
    const [d] = await tickAt("2026-12-04T09:00:30.000Z");
    expect(d).toMatchObject({ kind: "issue", targetKey: "NEX-1", title: "Build calendar view", detail: "Due today", status: "delivered", scheduledAt: "2026-12-04T09:00:00.000Z" });
    for (const t of ["2026-12-04T09:01:00.000Z", "2026-12-04T09:05:00.000Z", "2026-12-04T10:00:00.000Z"]) expect(await tickAt(t)).toEqual([]);
    expect(shown).toHaveLength(1);
    expect((await logOnDisk()).deliveries.map((x) => [x.targetKey, x.status])).toEqual([["NEX-1", "delivered"]]);
  });

  it("records what came due while Nexus was closed as missed, shows it once, and never delivers it", async () => {
    await tickAt("2026-12-04T12:00:00.000Z");
    await close();
    expect(await open("2026-12-06T12:00:00.000Z")).toBe(1); // NEX-1's 09:00 on 5 December passed while closed
    const first = scheduler.batch;
    const log = await logOnDisk();
    expect(log.deliveries).toEqual([expect.objectContaining({ targetKey: "NEX-1", status: "missed", batch: first, deliveredAt: null })]);
    expect(await tickAt("2026-12-06T12:01:00.000Z")).toEqual([]);
    expect(shown).toEqual([]);
    // Reopening again: no new missed entry, and the old one belongs to the earlier start-up.
    await close();
    expect(await open("2026-12-06T13:00:00.000Z")).toBe(0);
    expect(scheduler.batch).not.toBe(first);
    expect((await logOnDisk()).deliveries.filter((d) => d.batch === scheduler.batch)).toEqual([]);
  });

  it("treats an entry left “delivering” by a crash as missed, not as a new reminder", async () => {
    const log = { schemaVersion: 1, seenUpTo: null, deliveries: [{
      id: "dlv_01KAR5Y3S2M8Q4K7Y2C9X5V6D1", key: "issue:iss_01KAR5Y3S2M8Q4K7Y2C9X5V6B3:allday-0900:2026-12-05T09:00:00.000Z", kind: "issue",
      targetId: "iss_01KAR5Y3S2M8Q4K7Y2C9X5V6B3", targetKey: "NEX-1", title: "Build calendar view", detail: "Due today", workspaceId: service.manifest.workspaceId,
      rule: "allday-0900", scheduledAt: "2026-12-05T09:00:00.000Z", status: "delivering", deliveredAt: null, batch: null,
    }] };
    await close();
    await writeFile(join(ws, ".nexus", "state", "deliveries.json"), JSON.stringify(log));
    await open("2026-12-05T09:10:00.000Z");
    expect((await logOnDisk()).deliveries).toEqual([expect.objectContaining({ status: "missed", batch: scheduler.batch })]);
    expect(await tickAt("2026-12-05T09:20:00.000Z")).toEqual([]);
    expect(shown).toEqual([]);
  });

  it("delivers a synthetic calendar event from the shared record", async () => {
    await writeFile(join(ws, ".nexus", "calendar.json"), JSON.stringify({ schemaVersion: 1, events: [
      { id: "evt_01KAR5Y3S2M8Q4K7Y2C9X5V6E1", title: "Fictional demo rehearsal", start: { dateTime: "2026-12-02T15:00:00.000Z", timeZone: "Europe/London" } },
    ] }));
    const [d] = await tickAt("2026-12-02T14:00:10.000Z");
    expect(d).toMatchObject({ kind: "event", targetKey: "2026-12", title: "Fictional demo rehearsal", detail: "Starts at 15:00" });
  });

  it("follows the settings: a new time of day, and nothing at all when reminders are off", async () => {
    await scheduler.saveSettings({ ...(await scheduler.settings()), allDayTime: "07:30" });
    expect(await tickAt("2026-12-05T07:31:00.000Z")).toEqual([expect.objectContaining({ targetKey: "NEX-1", rule: "allday-0730" })]);
    await scheduler.saveSettings({ ...(await scheduler.settings()), enabled: false, allDayTime: "08:00" });
    expect(await tickAt("2026-12-05T08:30:00.000Z")).toEqual([]);
    expect(JSON.parse(await readFile(join(ws, ".nexus", "reminders.json"), "utf8"))).toMatchObject({ enabled: false, allDayTime: "08:00" });
  });

  it("delivers the labelled test reminder at once, even with reminders off", async () => {
    await scheduler.saveSettings({ ...(await scheduler.settings()), enabled: false });
    const d = await scheduler.test();
    expect(d).toMatchObject({ kind: "test", title: "Test reminder", targetKey: "NEX-1", status: "delivered" });
    expect(shown).toEqual([expect.objectContaining({ id: d.id })]);
  });
});
