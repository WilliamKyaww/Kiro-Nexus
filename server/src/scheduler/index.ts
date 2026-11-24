// Wires the B4 scheduler into the service lifecycle and the HTTP API.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ReminderSettings, ReminderSettingsPatch, type Delivery, type NotificationsView } from "@nexus/schema";
import type { RouteContext } from "../app";
import { NexusError } from "../errors";
import { engineFor } from "../review";
import type { AppState } from "../state";
import { Scheduler, TestClock, realClock, type Clock } from "./scheduler";

const schedulers = new WeakMap<AppState, Scheduler>();
/** Whether the desktop app can show native notifications (null in the browser). */
const native = new WeakMap<AppState, { available: boolean; reason: string | null }>();

/**
 * The clock. NEXUS_TEST_CLOCK=<ISO instant> starts a frozen clock that only the process that
 * started the service can move (POST /api/v1/control/clock, with the control secret).
 */
const testClock = process.env.NEXUS_TEST_CLOCK ? new TestClock(new Date(process.env.NEXUS_TEST_CLOCK)) : null;
export const clock: Clock = testClock ?? realClock;
export const hasTestClock = () => testClock !== null;

export function requireScheduler(state: AppState): Scheduler {
  const s = schedulers.get(state);
  if (!s || !state.service || s.service !== state.service) throw new NexusError("NO_WORKSPACE", "No workspace is open.");
  return s;
}

export function setNativeStatus(state: AppState, status: { available: boolean; reason: string | null }): void {
  native.set(state, status);
}

export function installReminders(state: AppState): void {
  state.onOpen.push(async (service) => {
    // Runs inside the open sequence: review recovery has run, but state.service is not set yet.
    const engine = engineFor(state);
    if (!engine) throw new NexusError("INTERNAL", "Reminders need the review journal, which did not load.");
    const scheduler: Scheduler = new Scheduler(service, engine, (delivery: Delivery) => {
      // One delivery record; each surface shows it. `native` tells the desktop app whether to
      // add the operating system's notification (a setting of this workspace).
      void scheduler.settings().then((s) => state.publish({ type: "notification", delivery, native: s.nativeNotifications }));
    }, state.log, clock);
    schedulers.set(state, scheduler);
    await scheduler.start(testClock ? 0 : undefined).catch((e) => state.log(`reminders: ${(e as Error).message}`));
  });
  state.onClose.push(async (service) => {
    const s = schedulers.get(state);
    if (s && s.service === service) { s.stop(); schedulers.delete(state); }
  });
  // An accepted date, a manual edit or a new event: reschedule without waiting for the timer.
  state.bus.on("event", (e: { type: string; path?: string }) => {
    if (e.type === "review.updated" || (e.type === "file.changed" && typeof e.path === "string" && e.path.startsWith(".nexus/") && !e.path.startsWith(".nexus/state"))) {
      schedulers.get(state)?.poke();
    }
  });
}

const SetClock = z.strictObject({ now: z.iso.datetime({ offset: false }) });
const SeenRequest = z.strictObject({ upTo: z.iso.datetime({ offset: false }) });

export function reminderRoutes(state: AppState) {
  return (app: FastifyInstance, rc: RouteContext) => {
    app.get("/api/v1/notifications", async (): Promise<NotificationsView> => {
      const s = requireScheduler(state);
      const log = await s.readLog();
      const deliveries = [...log.deliveries].sort((a, b) => (b.deliveredAt ?? b.scheduledAt).localeCompare(a.deliveredAt ?? a.scheduledAt)).slice(0, 200);
      const seen = log.seenUpTo ? new Date(log.seenUpTo).getTime() : 0;
      return {
        deliveries,
        away: log.deliveries.filter((d) => d.status === "missed" && d.batch === s.batch),
        // An entry still "delivering" is being shown right now (DEC-009 writes "delivered" after).
        unseen: log.deliveries.filter((d) => (d.status === "delivered" || d.status === "delivering") && new Date(d.deliveredAt ?? d.scheduledAt).getTime() > seen).length,
        settings: await s.settings(),
        native: native.get(state) ?? (process.env.NEXUS_DESKTOP === "1" ? { available: false, reason: "The desktop app has not reported its notification support yet." } : null),
        workspaceId: s.service.manifest.workspaceId,
      };
    });
    app.get("/api/v1/notifications/:id", async (request) => {
      const id = (request.params as { id: string }).id;
      const s = requireScheduler(state);
      const d = (await s.readLog()).deliveries.find((x) => x.id === id);
      if (!d) throw new NexusError("NOT_FOUND", "This reminder is no longer in this workspace's history.");
      return { delivery: d, workspaceId: s.service.manifest.workspaceId };
    });
    app.post("/api/v1/notifications/seen", async (request) => {
      const { upTo } = rc.parse(SeenRequest, request.body);
      await requireScheduler(state).markSeen(new Date(upTo));
      state.publish({ type: "notifications.seen" });
      return { ok: true };
    });
    app.get("/api/v1/reminders/settings", async () => requireScheduler(state).settings());
    app.put("/api/v1/reminders/settings", async (request) => {
      const patch = rc.parse(ReminderSettingsPatch, request.body);
      const s = requireScheduler(state);
      return s.saveSettings(ReminderSettings.parse({ ...(await s.settings()), ...patch }));
    });
    app.post("/api/v1/reminders/test", async () => ({ delivery: await requireScheduler(state).test() }));
    // Test-only: move the frozen clock and tick. Needs the control secret; absent without NEXUS_TEST_CLOCK.
    if (testClock) {
      app.post("/api/v1/control/clock", async (request) => {
        const { now } = rc.parse(SetClock, request.body);
        testClock.set(new Date(now));
        const s = schedulers.get(state);
        return { now, delivered: s && state.service ? await s.tick() : [] };
      });
    }
  };
}
