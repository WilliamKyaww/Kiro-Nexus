// B4 scheduler (architecture section 8, DEC-009): one per open workspace. It delivers each
// reminder occurrence at most once, from accepted values only, while Nexus is running, and
// records what came due while Nexus was closed as missed.
import {
  DEFAULT_REMINDER_SETTINGS, DeliveryLog, ReminderSettings, SchedulerState, serialise,
  type CalendarEvent, type DamagedLogDetails, type Delivery, type DeliveryLog as DeliveryLogT, type ReminderProblem,
} from "@nexus/schema";
import { NexusError } from "../errors";
import { faultPoint } from "../faults";
import type { ReviewEngine } from "../review/engine";
import { newId, type WorkspaceService } from "../workspace/service";
import { effectiveAcceptedIssues, occurrences, readCalendar, type Occurrence } from "./reminders";

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
const LOG_FILE = ".nexus/state/deliveries.json";

/**
 * The delivery log exists but cannot be read or is not valid (R5-5). It is never taken for a new
 * log, because that could repeat reminders: nothing is delivered and the file is left as it is
 * until it is repaired or replaced on request.
 */
function damagedLog(cause: string): NexusError {
  const details: DamagedLogDetails = { file: LOG_FILE, recovery: "replace-delivery-log" };
  return new NexusError("INVALID_DATA", `The reminder delivery log (${LOG_FILE}) ${cause}, so Nexus is not delivering reminders. Nexus has not changed the file. Repair it, or start a new delivery log from Notifications.`, details);
}
const isDamagedLog = (e: unknown) => e instanceof NexusError && (e.details as Partial<DamagedLogDetails> | undefined)?.recovery === "replace-delivery-log";
const stoppedError = () => new NexusError("NO_WORKSPACE", "No workspace is open.");

export class Scheduler {
  /** The start-up this scheduler belongs to: missed reminders recorded now form its summary. */
  readonly batch = newId("bat");
  private chain: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private stopped = false;
  /** Whether the start-up step has run. Until it has, no tick delivers anything (R5-5). */
  private ready = false;
  private warned = new Set<string>();
  private lastFailure: string | null = null;

  constructor(
    readonly service: WorkspaceService,
    private readonly engine: ReviewEngine,
    /** Called synchronously with each delivery and the settings it was computed with (R5-13). */
    private readonly deliver: (delivery: Delivery, settings: ReminderSettings) => void,
    private readonly log: (line: string) => void,
    readonly clock: Clock,
  ) {}

  get isStopped(): boolean { return this.stopped; }

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

  /**
   * Calendar events from the shared record. Hein's slice writes it; a missing file means none.
   * Each row is checked on its own, so one bad event is skipped and reported (R5-4, R5-6).
   */
  async events(): Promise<{ events: CalendarEvent[]; problems: ReminderProblem[] }> {
    const raw = await this.service.readDataFile("calendar.json");
    if (raw === null) return { events: [], problems: [] };
    return readCalendar(raw);
  }

  /**
   * The delivery log. Only a missing file is a new log (R5-5); then anything at or before the
   * last tick may already have been delivered, so it is the log's boundary.
   */
  async readLog(): Promise<DeliveryLogT> {
    let raw: string | null;
    try { raw = await this.service.readStateFile("deliveries.json"); } catch (e) {
      const code = e instanceof Error ? /\((\w+)\)\.$/.exec(e.message)?.[1] : undefined;
      throw damagedLog(`could not be read${code ? ` (${code})` : ""}`);
    }
    if (raw === null) {
      const last = await this.lastTickAt();
      return { schemaVersion: 1, seenUpTo: null, deliveries: [], ...(last ? { prunedUpTo: last.toISOString() } : {}) };
    }
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw damagedLog(raw.trim() ? "is not valid JSON" : "is empty"); }
    const parsed = DeliveryLog.safeParse(value);
    if (!parsed.success) throw damagedLog("is not in the format Nexus expects");
    return parsed.data;
  }

  /**
   * Prunes entries older than 60 days beyond the newest 500. The latest pruned instant becomes
   * the log's boundary, so a pruned occurrence is never delivered again, even if the clock goes
   * back before it (R5-6).
   */
  private async writeLog(log: DeliveryLogT): Promise<void> {
    const cutoff = this.clock.now().getTime() - KEEP_DAYS * 86_400_000;
    if (log.deliveries.length > KEEP) {
      const extra = log.deliveries.length - KEEP;
      let dropped = 0;
      let boundary = log.prunedUpTo ? new Date(log.prunedUpTo).getTime() : Number.NEGATIVE_INFINITY;
      log.deliveries = log.deliveries.filter((d) => {
        const at = new Date(d.scheduledAt).getTime();
        if (dropped < extra && d.status !== "delivering" && at < cutoff) { dropped++; boundary = Math.max(boundary, at); return false; }
        return true;
      });
      if (dropped) log.prunedUpTo = new Date(boundary).toISOString();
    }
    await this.service.writeStateFile("deliveries.json", serialise(DeliveryLog, log));
  }

  private async lastTickAt(): Promise<Date | null> {
    const raw = await this.service.readStateFile("scheduler.json");
    if (raw === null) return null;
    try { const s = SchedulerState.parse(JSON.parse(raw)); return s.lastTickAt ? new Date(s.lastTickAt) : null; } catch {
      this.warnOnce("scheduler-state", "reminders: .nexus/state/scheduler.json is not valid; reminders that came due while Nexus was closed cannot be listed");
      return null;
    }
  }

  private async setLastTickAt(at: Date): Promise<void> {
    await this.service.writeStateFile("scheduler.json", serialise(SchedulerState, { schemaVersion: 1, lastTickAt: at.toISOString() }));
  }

  private warnOnce(key: string, line: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.log(line);
  }

  /** A failed start or tick is logged once, not on every tick while the cause lasts. */
  private failed(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    if (message === this.lastFailure) return;
    this.lastFailure = message;
    this.log(`reminders: ${message.slice(0, 240)}`);
  }

  // ---------------- Occurrences ----------------

  /** Every occurrence from accepted data, and the records that had to be skipped (R5-4). */
  private async compute(settings: ReminderSettings): Promise<{ list: Occurrence[]; problems: ReminderProblem[] }> {
    const issues = effectiveAcceptedIssues(this.service.listIssues(), this.engine.unsettledChanges());
    const { events, problems } = await this.events();
    const list = occurrences(issues, events, settings, this.service.manifest.timeZone, (p) => problems.push(p));
    // Named by file and record only: titles and field values are workspace content.
    for (const p of problems) this.warnOnce(`problem:${p.file}:${p.record}`, `reminders: skipped ${p.record ? `${p.record} in ` : ""}${p.file}; the other reminders are unaffected`);
    return { list, problems };
  }

  /** The records that have no reminder because they could not be scheduled (Notifications shows them). */
  async problems(): Promise<ReminderProblem[]> {
    return (await this.compute(await this.settings())).problems;
  }

  /** Accepted occurrences in (from, to], after the log's boundary, that have no delivery record yet. */
  private async dueBetween(from: Date, to: Date, log: DeliveryLogT): Promise<{ due: Occurrence[]; settings: ReminderSettings }> {
    const settings = await this.settings();
    if (!settings.enabled) return { due: [], settings };
    const { list } = await this.compute(settings);
    const known = new Set(log.deliveries.map((d) => d.key));
    const floor = Math.max(from.getTime(), log.prunedUpTo ? new Date(log.prunedUpTo).getTime() : Number.NEGATIVE_INFINITY);
    return { due: list.filter((o) => o.at.getTime() > floor && o.at.getTime() <= to.getTime() && !known.has(o.key)), settings };
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
   *
   * The timer starts even if this step fails (a damaged log): each tick tries the step again
   * first, so repairing the file brings reminders back without reopening (R5-5).
   */
  async start(intervalMs = TICK_MS): Promise<number> {
    if (intervalMs > 0 && !this.timer && !this.stopped) {
      this.timer = setInterval(() => { void this.tick().catch((e) => this.failed(e)); }, intervalMs);
      this.timer.unref?.();
    }
    return this.serial(() => this.startUp()).catch((e) => { this.failed(e); throw e; });
  }

  private async startUp(): Promise<number> {
    if (this.ready) return 0;
    const now = this.clock.now();
    const log = await this.readLog();
    let count = 0;
    for (const d of log.deliveries) {
      if (d.status === "delivering") { d.status = "missed"; d.batch = this.batch; count++; }
    }
    const last = await this.lastTickAt();
    if (last && last.getTime() < now.getTime()) {
      for (const o of (await this.dueBetween(last, now, log)).due) { log.deliveries.push(this.entry(o, "missed")); count++; }
    }
    if (this.stopped) return 0;
    if (count) await this.writeLog(log);
    await this.setLastTickAt(now);
    this.ready = true;
    this.lastFailure = null;
    if (count) this.log(`reminders: ${count} reminder${count === 1 ? "" : "s"} came due while Nexus was closed`);
    return count;
  }

  /**
   * Stops ticking. Work already running records and shows nothing more after this (R5-13); the
   * promise settles once it has finished, so the workspace can close behind it.
   */
  stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
    return this.chain.then(() => undefined);
  }

  /** Deliver every accepted occurrence that came due since the last tick, once each. */
  tick(): Promise<Delivery[]> {
    return this.serial(async () => {
      if (this.stopped) return [];
      faultPoint("scheduler:tick");
      if (!this.ready) await this.startUp();
      if (this.stopped) return [];
      const now = this.clock.now();
      const last = (await this.lastTickAt()) ?? now;
      if (now.getTime() <= last.getTime()) return []; // the clock has not moved on (or went back)
      const log = await this.readLog();
      const { due, settings } = await this.dueBetween(last, now, log);
      const delivered: Delivery[] = [];
      for (const o of due) {
        // Stopped while reading: nothing more is recorded or shown, and the boundary stays, so
        // the next start lists these as missed (R5-13).
        if (this.stopped) return delivered;
        const d = this.entry(o, "delivering");
        log.deliveries.push(d);
        await this.writeLog(log); // the intent is durable before anything is shown (DEC-009)
        faultPoint("scheduler:after-delivering");
        // Stopped during that write: the entry stays "delivering", which the next start records as missed.
        if (this.stopped) return delivered;
        d.status = "delivered";
        d.deliveredAt = now.toISOString();
        this.deliver({ ...d }, settings);
        await this.writeLog(log);
        delivered.push(d);
      }
      if (this.stopped) return delivered;
      await this.setLastTickAt(now);
      this.lastFailure = null;
      return delivered;
    });
  }

  /** After a data change (an accepted date, a manual edit): tick soon, without waiting for the timer. */
  poke(): void {
    if (this.stopped) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.tick().catch((e) => this.failed(e)); }, 250);
    this.debounce.unref?.();
  }

  /** "Send test reminder": delivered at once, labelled as a test, through every surface (PRD-044). */
  test(): Promise<Delivery> {
    return this.serial(async () => {
      if (this.stopped) throw stoppedError();
      const now = this.clock.now();
      const issue = effectiveAcceptedIssues(this.service.listIssues(), this.engine.unsettledChanges())[0];
      const d: Delivery = {
        id: newId("dlv"), key: `test:${newId("tst")}`, kind: "test", targetId: issue?.id ?? null, targetKey: issue?.key ?? null,
        title: "Test reminder", detail: issue ? `A test. It opens ${issue.key} ${issue.title}.` : "A test. Reminders appear like this.",
        workspaceId: this.service.manifest.workspaceId, rule: "test", scheduledAt: now.toISOString(), status: "delivering", deliveredAt: null, batch: null,
      };
      const settings = await this.settings();
      const log = await this.readLog();
      if (this.stopped) throw stoppedError();
      log.deliveries.push(d);
      await this.writeLog(log);
      if (this.stopped) throw stoppedError(); // left "delivering": the next start lists it once as missed
      d.status = "delivered";
      d.deliveredAt = now.toISOString();
      this.deliver({ ...d }, settings);
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

  /**
   * "Start a new delivery log" (R5-5): only when the log is damaged. A copy of the damaged file
   * is kept beside it, and the new log's boundary is now (or the last tick, if later), so nothing
   * that came due before is delivered or listed again. Then the start-up step runs if it had
   * failed, and ticks carry on.
   */
  replaceDamagedLog(): Promise<{ keptAs: string }> {
    return this.serial(async () => {
      if (this.stopped) throw stoppedError();
      const damaged = await this.readLog().then(() => false, (e: unknown) => { if (isDamagedLog(e)) return true; throw e; });
      if (!damaged) throw new NexusError("CONFLICT", "The reminder delivery log is not damaged, so Nexus did not replace it.");
      const now = this.clock.now();
      const last = await this.lastTickAt();
      const boundary = last && last.getTime() > now.getTime() ? last : now;
      const keptAs = await this.service.keepDamagedStateFile("deliveries.json", now);
      await this.service.writeStateFile("deliveries.json", serialise(DeliveryLog, { schemaVersion: 1, seenUpTo: now.toISOString(), deliveries: [], prunedUpTo: boundary.toISOString() }));
      this.log(`reminders: started a new delivery log; the damaged one is kept as ${keptAs}`);
      this.lastFailure = null;
      if (!this.ready) await this.startUp();
      return { keptAs };
    });
  }
}
