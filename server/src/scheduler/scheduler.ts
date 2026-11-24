// B4 scheduler (architecture section 8, DEC-009): one per open workspace. It delivers each
// reminder occurrence at most once, from accepted values only, while Nexus is running, and
// records what came due while Nexus was closed as missed.
import {
  CalendarFile, DEFAULT_REMINDER_SETTINGS, DeliveryLog, ReminderSettings, SchedulerState, serialise,
  type CalendarEvent, type Delivery, type DeliveryLog as DeliveryLogT,
} from "@nexus/schema";
import { faultPoint } from "../faults";
import type { ReviewEngine } from "../review/engine";
import { newId, type WorkspaceService } from "../workspace/service";
import { effectiveAcceptedIssues, occurrences, type Occurrence } from "./reminders";

export interface Clock { now(): Date }
export const realClock: Clock = { now: () => new Date() };

/** A clock that only moves when told to (NEXUS_TEST_CLOCK). */
export class TestClock implements Clock {
  constructor(private at: Date) {}
  now(): Date { return new Date(this.at); }
  set(at: Date): void { this.at = at; }
}

const TICK_MS = 30_000;
const KEEP = 500;
const KEEP_DAYS = 60;

export class Scheduler {
  /** The start-up this scheduler belongs to: missed reminders recorded now form its summary. */
  readonly batch = newId("bat");
  private chain: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private stopped = false;
  private warned = new Set<string>();

  constructor(
    readonly service: WorkspaceService,
    private readonly engine: ReviewEngine,
    private readonly deliver: (delivery: Delivery) => void,
    private readonly log: (line: string) => void,
    readonly clock: Clock,
  ) {}

  /** Work runs one piece at a time, so two ticks can never deliver the same occurrence. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // ---------------- Files ----------------

  async settings(): Promise<ReminderSettings> {
    const raw = await this.service.readDataFile("reminders.json");
    if (!raw) return DEFAULT_REMINDER_SETTINGS;
    try { return ReminderSettings.parse(JSON.parse(raw)); } catch { this.warnOnce("settings", "reminders: reminders.json is not valid; using the default timing"); return DEFAULT_REMINDER_SETTINGS; }
  }

  async saveSettings(next: ReminderSettings): Promise<ReminderSettings> {
    await this.service.writeDataFile("reminders.json", serialise(ReminderSettings, next));
    this.poke();
    return next;
  }

  /** Calendar events from the shared record. Hein's slice writes it; a missing file means none. */
  async events(): Promise<CalendarEvent[]> {
    const raw = await this.service.readDataFile("calendar.json");
    if (!raw) return [];
    const parsed = CalendarFile.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
    if (!parsed.success) { this.warnOnce("calendar", "reminders: calendar.json is not valid; its events are skipped"); return []; }
    return parsed.data.events;
  }

  async readLog(): Promise<DeliveryLogT> {
    const raw = await this.service.readStateFile("deliveries.json");
    if (!raw) return { schemaVersion: 1, seenUpTo: null, deliveries: [] };
    try { return DeliveryLog.parse(JSON.parse(raw)); } catch {
      // An unreadable log must never cause duplicates: refuse to deliver until it is fixed.
      throw new Error("The reminder delivery log (.nexus/state/deliveries.json) is not valid, so no reminders are delivered.");
    }
  }

  private async writeLog(log: DeliveryLogT): Promise<void> {
    const cutoff = this.clock.now().getTime() - KEEP_DAYS * 86_400_000;
    if (log.deliveries.length > KEEP) {
      const extra = log.deliveries.length - KEEP;
      let dropped = 0;
      log.deliveries = log.deliveries.filter((d) => {
        if (dropped < extra && d.status !== "delivering" && new Date(d.scheduledAt).getTime() < cutoff) { dropped++; return false; }
        return true;
      });
    }
    await this.service.writeStateFile("deliveries.json", serialise(DeliveryLog, log));
  }

  private async lastTickAt(): Promise<Date | null> {
    const raw = await this.service.readStateFile("scheduler.json");
    if (!raw) return null;
    try { const s = SchedulerState.parse(JSON.parse(raw)); return s.lastTickAt ? new Date(s.lastTickAt) : null; } catch { return null; }
  }

  private async setLastTickAt(at: Date): Promise<void> {
    await this.service.writeStateFile("scheduler.json", serialise(SchedulerState, { schemaVersion: 1, lastTickAt: at.toISOString() }));
  }

  private warnOnce(key: string, line: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.log(line);
  }

  // ---------------- Occurrences ----------------

  /** Accepted occurrences in (from, to] that have no delivery record yet. */
  private async dueBetween(from: Date, to: Date, log: DeliveryLogT): Promise<Occurrence[]> {
    const settings = await this.settings();
    if (!settings.enabled) return [];
    const issues = effectiveAcceptedIssues(this.service.listIssues(), this.engine.unsettledChanges());
    const known = new Set(log.deliveries.map((d) => d.key));
    return occurrences(issues, await this.events(), settings, this.service.manifest.timeZone)
      .filter((o) => o.at.getTime() > from.getTime() && o.at.getTime() <= to.getTime() && !known.has(o.key));
  }

  private entry(o: Occurrence, status: Delivery["status"]): Delivery {
    return {
      id: newId("dlv"), key: o.key, kind: o.kind, targetId: o.targetId, targetKey: o.targetKey, title: o.title, detail: o.detail,
      workspaceId: this.service.manifest.workspaceId, rule: o.rule, scheduledAt: o.at.toISOString(), status,
      deliveredAt: null, batch: status === "missed" ? this.batch : null,
    };
  }

  // ---------------- Lifecycle ----------------

  /**
   * On opening the workspace: an entry left "delivering" by a crash, and every occurrence
   * that came due while Nexus was closed, are recorded as missed in this start-up's batch,
   * and are never shown as new reminders. Then ticks begin.
   */
  async start(intervalMs = TICK_MS): Promise<number> {
    const missed = await this.serial(async () => {
      const now = this.clock.now();
      const log = await this.readLog();
      let count = 0;
      for (const d of log.deliveries) {
        if (d.status === "delivering") { d.status = "missed"; d.batch = this.batch; count++; }
      }
      const last = await this.lastTickAt();
      if (last && last.getTime() < now.getTime()) {
        for (const o of await this.dueBetween(last, now, log)) { log.deliveries.push(this.entry(o, "missed")); count++; }
      }
      if (count) await this.writeLog(log);
      await this.setLastTickAt(now);
      return count;
    });
    if (missed) this.log(`reminders: ${missed} reminder${missed === 1 ? "" : "s"} came due while Nexus was closed`);
    if (intervalMs > 0) {
      this.timer = setInterval(() => { void this.tick().catch((e) => this.log(`reminders: tick failed: ${(e as Error).message.slice(0, 120)}`)); }, intervalMs);
      this.timer.unref?.();
    }
    return missed;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  /** Deliver every accepted occurrence that came due since the last tick, once each. */
  tick(): Promise<Delivery[]> {
    return this.serial(async () => {
      if (this.stopped) return [];
      faultPoint("scheduler:tick");
      const now = this.clock.now();
      const last = (await this.lastTickAt()) ?? now;
      if (now.getTime() <= last.getTime()) return []; // the clock has not moved on (or went back)
      const log = await this.readLog();
      const delivered: Delivery[] = [];
      for (const o of await this.dueBetween(last, now, log)) {
        const d = this.entry(o, "delivering");
        log.deliveries.push(d);
        await this.writeLog(log); // the intent is durable before anything is shown (DEC-009)
        faultPoint("scheduler:after-delivering");
        d.status = "delivered";
        d.deliveredAt = now.toISOString();
        this.deliver({ ...d });
        await this.writeLog(log);
        delivered.push(d);
      }
      await this.setLastTickAt(now);
      return delivered;
    });
  }

  /** After a data change (an accepted date, a manual edit): tick soon, without waiting for the timer. */
  poke(): void {
    if (this.stopped) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.tick().catch(() => undefined); }, 250);
    this.debounce.unref?.();
  }

  /** "Send test reminder": delivered at once, labelled as a test, through every surface (PRD-044). */
  test(): Promise<Delivery> {
    return this.serial(async () => {
      const now = this.clock.now();
      const issue = effectiveAcceptedIssues(this.service.listIssues(), this.engine.unsettledChanges())[0];
      const d: Delivery = {
        id: newId("dlv"), key: `test:${newId("tst")}`, kind: "test", targetId: issue?.id ?? null, targetKey: issue?.key ?? null,
        title: "Test reminder", detail: issue ? `A test. It opens ${issue.key} ${issue.title}.` : "A test. Reminders appear like this.",
        workspaceId: this.service.manifest.workspaceId, rule: "test", scheduledAt: now.toISOString(), status: "delivering", deliveredAt: null, batch: null,
      };
      const log = await this.readLog();
      log.deliveries.push(d);
      await this.writeLog(log);
      d.status = "delivered";
      d.deliveredAt = now.toISOString();
      this.deliver({ ...d });
      await this.writeLog(log);
      return d;
    });
  }

  markSeen(upTo: Date): Promise<void> {
    return this.serial(async () => {
      const log = await this.readLog();
      if (log.seenUpTo && new Date(log.seenUpTo).getTime() >= upTo.getTime()) return;
      log.seenUpTo = upTo.toISOString();
      await this.writeLog(log);
    });
  }
}
