// B4 over HTTP against the real service process: a crash between recording a delivery's
// intent and confirming it (NEXUS_FAULT, exit 86) is recovered as missed and never shown
// again (DEC-009), and the test clock route is protected and absent unless enabled.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client, openSession, startService, type RunningService } from "../../test/harness";
import { copySampleWorkspace } from "../workspace/service";

let base: string;
let ws: string;
const running: RunningService[] = [];
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "nexus-sched-http-"));
  ws = await copySampleWorkspace(join(process.cwd(), "samples", "meeting-workspace"), join(base, "ws"));
});
afterEach(async () => {
  for (const s of running.splice(0)) if (s.child.exitCode === null) await s.stop();
  await rm(base, { recursive: true, force: true });
});
const start = async (env: Record<string, string>) => { const s = await startService({ profile: join(base, "profile"), workspace: ws, env }); running.push(s); return s; };
const setClock = (s: RunningService, now: string) => fetch(`http://127.0.0.1:${s.port}/api/v1/control/clock`, {
  method: "POST", headers: { authorization: `Bearer ${s.controlSecret}`, "content-type": "application/json" }, body: JSON.stringify({ now }),
});
const deliveries = async () => JSON.parse(await readFile(join(ws, ".nexus", "state", "deliveries.json"), "utf8")).deliveries as Array<{ status: string; targetKey: string; batch: string | null }>;

describe("reminders in the real service", () => {
  it("a crash after the intent is written: the reminder becomes missed on restart and is not shown again", async () => {
    const crashing = await start({ NEXUS_TEST_CLOCK: "2026-12-05T08:00:00.000Z", NEXUS_FAULT: "scheduler:after-delivering" });
    const exited = new Promise<number | null>((r) => crashing.child.once("exit", r));
    await setClock(crashing, "2026-12-05T09:00:30.000Z").catch(() => undefined); // the process dies mid-request
    expect(await exited).toBe(86);
    expect(await deliveries()).toEqual([expect.objectContaining({ targetKey: "NEX-1", status: "delivering" })]);

    const svc = await start({ NEXUS_TEST_CLOCK: "2026-12-05T09:05:00.000Z" });
    const api = client(svc, await openSession(svc));
    const view = (await api.get("/notifications")).body;
    expect(view.away).toEqual([expect.objectContaining({ targetKey: "NEX-1", status: "missed" })]);
    expect(view.unseen).toBe(0);
    expect((await (await setClock(svc, "2026-12-05T09:30:00.000Z")).json()).delivered).toEqual([]);
    expect(await deliveries()).toEqual([expect.objectContaining({ status: "missed" })]);
  });

  it("delivers once through the API, counts it as unseen until seen, and keeps the test clock behind the control secret", async () => {
    const svc = await start({ NEXUS_TEST_CLOCK: "2026-12-05T08:00:00.000Z" });
    const api = client(svc, await openSession(svc));
    const token = await openSession(svc);
    const asSession = await fetch(`http://127.0.0.1:${svc.port}/api/v1/control/clock`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
    expect(asSession.status).toBe(401); // a browser session cannot move the clock
    const first = await (await setClock(svc, "2026-12-05T09:00:30.000Z")).json();
    expect(first.delivered).toEqual([expect.objectContaining({ targetKey: "NEX-1", status: "delivered" })]);
    expect((await (await setClock(svc, "2026-12-05T09:10:00.000Z")).json()).delivered).toEqual([]);
    const view = (await api.get("/notifications")).body;
    expect(view).toMatchObject({ unseen: 1, away: [], native: null, settings: { enabled: true, allDayTime: "09:00", timedOffsetMinutes: 60 } });
    await api.post("/notifications/seen", { upTo: view.deliveries[0].deliveredAt });
    expect((await api.get("/notifications")).body.unseen).toBe(0);
    expect((await api.get(`/notifications/${first.delivered[0].id}`)).body.delivery).toMatchObject({ targetKey: "NEX-1" });
    expect((await api.put("/reminders/settings", { allDayTime: "25:00" })).status).toBe(400);
    expect((await api.post("/reminders/test")).body.delivery).toMatchObject({ kind: "test", title: "Test reminder" });
  });

  it("R5-5: a zero-byte delivery log is reported with its file and the way out, left alone, and replaced only on request", async () => {
    const logFile = join(ws, ".nexus", "state", "deliveries.json");
    await mkdir(join(ws, ".nexus", "state"), { recursive: true });
    await writeFile(logFile, "");
    const svc = await start({ NEXUS_TEST_CLOCK: "2026-12-05T08:00:00.000Z" });
    const api = client(svc, await openSession(svc));
    const view = await api.get("/notifications");
    expect(view.status).toBe(500);
    expect(view.body.error).toMatchObject({ code: "INVALID_DATA", details: { file: ".nexus/state/deliveries.json", recovery: "replace-delivery-log" } });
    expect(view.body.error.message).toContain(".nexus/state/deliveries.json");
    expect((await api.post("/reminders/test")).body.error).toMatchObject({ code: "INVALID_DATA" });
    expect((await (await setClock(svc, "2026-12-05T08:10:00.000Z")).json()).error).toMatchObject({ code: "INVALID_DATA" });
    expect(await readFile(logFile, "utf8")).toBe(""); // nothing was written over the damaged file

    const replaced = await api.post("/reminders/delivery-log/replace");
    expect(replaced.status).toBe(200);
    expect(replaced.body.keptAs).toMatch(/^\.nexus\/state\/deliveries\.damaged-[0-9TZ-]+\.json$/);
    expect(await readFile(join(ws, ...String(replaced.body.keptAs).split("/")), "utf8")).toBe("");
    expect((await api.post("/reminders/delivery-log/replace")).status).toBe(409); // a valid log is never replaced
    expect((await (await setClock(svc, "2026-12-05T09:00:30.000Z")).json()).delivered).toEqual([expect.objectContaining({ targetKey: "NEX-1", status: "delivered" })]);
    expect((await api.get("/notifications")).body).toMatchObject({ problems: [], unseen: 1 });
  });

  it("has no clock route without the test clock", async () => {
    const svc = await start({});
    // The route is not registered, so even the control secret gets an error (401, before routing).
    const res = await setClock(svc, "2026-12-05T09:00:30.000Z");
    expect(res.ok).toBe(false);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });
});
