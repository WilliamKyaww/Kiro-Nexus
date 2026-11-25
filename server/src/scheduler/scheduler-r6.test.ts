// R6-8 (Astra 6.2's run-6 review): a lost delivery log and a clock set back must not repeat an
// occurrence. In-process with the test clock, on a disposable copy of the fictional sample.
// Every check of the state files reads them on disk. The first two cases failed on the code at
// 67aeca0, where start-up replaced the checkpoint with the earlier time and so lost the floor.
import { access, readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeliveryLog, SchedulerState, type Delivery } from "@nexus/schema";
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
const stateFile = (name: string) => join(ws, ".nexus", "state", name);
const logOnDisk = async () => DeliveryLog.parse(JSON.parse(await readFile(stateFile("deliveries.json"), "utf8")));
const checkpointOnDisk = async () => SchedulerState.parse(JSON.parse(await readFile(stateFile("scheduler.json"), "utf8")));
const exists = (p: string) => access(p).then(() => true, () => false);
const NEX1 = "iss_01KAR5Y3S2M8Q4K7Y2C9X5V6B3";
const NEX1_5DEC = `issue:${NEX1}:allday-0900:2026-12-05T09:00:00.000Z`;

async function open(at: string) {
  clock.set(new Date(at));
  service = await WorkspaceService.open(ws, { lock: { pid: process.pid, instanceId: `r6-${++n}`, port: null, startedAt: new Date().toISOString() } });
  engine = await ReviewEngine.load(service, () => undefined, () => undefined);
  scheduler = new Scheduler(service, engine, (d) => shown.push(d), () => undefined, clock);
  return scheduler.start(0);
}
async function close() { await scheduler.stop(); await service.close(); }
const tickAt = async (at: string) => { clock.set(new Date(at)); return scheduler.tick(); };
/** Removes the fictional delivery log (if there is one) while Nexus is closed, and keeps the scheduler checkpoint. */
async function loseLog() {
  await rm(stateFile("deliveries.json"), { force: true });
  expect(await exists(stateFile("deliveries.json"))).toBe(false);
  expect(await exists(stateFile("scheduler.json"))).toBe(true);
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-sched-r6-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
  shown = [];
  await open("2026-12-01T08:00:00.000Z"); // first start: lastTickAt = 08:00 on 1 December
});
afterEach(async () => { await close().catch(() => undefined); await rm(base, { recursive: true, force: true }); });

describe("R6-8: a lost delivery log and a clock set back", () => {
  it("does not deliver NEX-1's 5 December reminder again when the log is removed and the clock reopens before 09:00", async () => {
    expect(await tickAt("2026-12-05T09:00:30.000Z")).toEqual([expect.objectContaining({ key: NEX1_5DEC, status: "delivered" })]);
    await close();
    expect((await checkpointOnDisk()).lastTickAt).toBe("2026-12-05T09:00:30.000Z");
    await loseLog();
    expect(await open("2026-12-05T08:00:00.000Z")).toBe(0); // the clock is set back before the same 09:00
    for (const t of ["2026-12-05T08:59:00.000Z", "2026-12-05T09:00:30.000Z", "2026-12-05T09:05:00.000Z"]) expect(await tickAt(t)).toEqual([]);
    expect(shown.map((d) => d.key)).toEqual([NEX1_5DEC]); // the original delivery only
    // The floor Nexus had passed is durable in both state files, whatever the clock now says.
    expect((await checkpointOnDisk()).lastTickAt).toBe("2026-12-05T09:05:00.000Z");
    expect((await logOnDisk()).prunedUpTo).toBe("2026-12-05T09:00:30.000Z");
  });

  it("does not deliver it again when the log is lost a second time while the clock is still behind", async () => {
    await tickAt("2026-12-05T09:00:30.000Z");
    await close();
    await loseLog();
    await open("2026-12-05T08:00:00.000Z");
    expect(await tickAt("2026-12-05T08:30:00.000Z")).toEqual([]);
    await close();
    await loseLog(); // the log written at the last start-up is lost too
    expect(await open("2026-12-05T08:40:00.000Z")).toBe(0);
    for (const t of ["2026-12-05T09:00:30.000Z", "2026-12-05T09:10:00.000Z"]) expect(await tickAt(t)).toEqual([]);
    expect(shown.map((d) => d.key)).toEqual([NEX1_5DEC]);
  });

  it("still lists an occurrence after the floor as missed when the log is lost and the clock moves on", async () => {
    // A fictional event the next day: its reminder is at 09:00 on 6 December (60 minutes before).
    await writeFile(join(ws, ".nexus", "calendar.json"), JSON.stringify({ schemaVersion: 1, events: [
      { id: "evt_01KAR5Y3S2M8Q4K7Y2C9X5V6E9", title: "Fictional review meeting", start: { dateTime: "2026-12-06T10:00:00.000Z", timeZone: "Europe/London" } },
    ] }));
    await tickAt("2026-12-05T09:00:30.000Z");
    await close();
    await loseLog();
    expect(await open("2026-12-06T12:00:00.000Z")).toBe(1); // the event's reminder; NEX-1's is at or before the floor
    const log = await logOnDisk();
    expect(log.deliveries).toEqual([expect.objectContaining({ kind: "event", status: "missed", batch: scheduler.batch })]);
    expect(log.deliveries.some((d) => d.key === NEX1_5DEC)).toBe(false);
    expect(shown.map((d) => d.key)).toEqual([NEX1_5DEC]);
  });
});

describe("R6-8: a clock set back while the log exists, then the log lost", () => {
  it("does not deliver the occurrence again: the latest time reached is kept apart from the last tick", async () => {
    expect(await tickAt("2026-12-05T09:00:30.000Z")).toEqual([expect.objectContaining({ key: NEX1_5DEC })]);
    await close();
    // Reopened with the clock set back and the log still there: the occurrence key protects it,
    // and the last tick follows the clock back.
    await open("2026-12-05T08:00:00.000Z");
    expect(await tickAt("2026-12-05T08:30:00.000Z")).toEqual([]);
    await close();
    const checkpoint = await checkpointOnDisk();
    expect(checkpoint.lastTickAt).toBe("2026-12-05T08:30:00.000Z");
    expect(checkpoint.passedUpTo).toBe("2026-12-05T09:00:30.000Z");
    await loseLog();
    expect(await open("2026-12-05T08:40:00.000Z")).toBe(0);
    for (const t of ["2026-12-05T09:00:30.000Z", "2026-12-05T09:10:00.000Z"]) expect(await tickAt(t)).toEqual([]);
    expect(shown.map((d) => d.key)).toEqual([NEX1_5DEC]);
    expect((await logOnDisk()).prunedUpTo).toBe("2026-12-05T09:00:30.000Z");
  });

  it("reads a checkpoint from before the R6 repairs, which has no passedUpTo", async () => {
    await tickAt("2026-12-05T09:00:30.000Z");
    await close();
    await writeFile(stateFile("scheduler.json"), JSON.stringify({ schemaVersion: 1, lastTickAt: "2026-12-05T09:00:30.000Z" }, null, 2) + "\n");
    await loseLog();
    expect(await open("2026-12-05T08:00:00.000Z")).toBe(0);
    expect(await tickAt("2026-12-05T09:01:00.000Z")).toEqual([]);
    expect(shown.map((d) => d.key)).toEqual([NEX1_5DEC]);
  });
});

describe("a genuine first use (no delivery log and no checkpoint)", () => {
  it("is silent about the past and delivers future reminders", async () => {
    await close();
    await rm(join(ws, ".nexus", "state"), { recursive: true, force: true });
    expect(await open("2026-12-05T09:30:00.000Z")).toBe(0); // NEX-1's 09:00 today is before first use
    expect(await tickAt("2026-12-05T09:31:00.000Z")).toEqual([]);
    expect(shown).toEqual([]);
    if (await exists(stateFile("deliveries.json"))) expect((await logOnDisk()).deliveries).toEqual([]);
    expect((await checkpointOnDisk()).lastTickAt).toBe("2026-12-05T09:31:00.000Z");
    // A future date by hand: it is delivered once at 09:00 on 6 December.
    const nex1 = service.listIssues().find((i) => i.key === "NEX-1")!;
    await service.updateIssue("NEX-1", nex1.revision, { due: { date: "2026-12-06" } });
    expect(await tickAt("2026-12-06T09:00:30.000Z")).toEqual([expect.objectContaining({ targetKey: "NEX-1", scheduledAt: "2026-12-06T09:00:00.000Z", status: "delivered" })]);
    expect(await tickAt("2026-12-06T09:05:00.000Z")).toEqual([]);
    expect(shown).toHaveLength(1);
  });
});
