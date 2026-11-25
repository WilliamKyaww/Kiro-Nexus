// B4 reminders: settings, the shared calendar event record (read here, written by Hein's
// slice), and the delivery log (DEC-009). Documented in docs/data-format.md.
import { z } from "zod";

const SCHEMA_VERSION = 1 as const; // local copy: index.ts re-exports this module
const IsoInstant = z.iso.datetime({ offset: false });
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const zoneChecks = new Map<string, boolean>();
/** Whether this runtime knows the IANA time zone (R5-4). A zone it does not know cannot be scheduled. */
export function isTimeZone(name: string): boolean {
  let known = zoneChecks.get(name);
  if (known === undefined) {
    // Intl also accepts offsets such as "+01:00"; only zone names are stored.
    try { known = /^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(name) && new Intl.DateTimeFormat("en-GB", { timeZone: name }).resolvedOptions().timeZone.length > 0; } catch { known = false; }
    zoneChecks.set(name, known);
  }
  return known;
}
export const TimeZoneName = z.string().min(1).max(64).refine(isTimeZone, "Nexus does not recognise this time zone");
const Due = z.union([z.null(), z.strictObject({ date: LocalDate }), z.strictObject({ dateTime: IsoInstant, timeZone: TimeZoneName })]);
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM, 24-hour");

/** `.nexus/reminders.json`: when ordinary reminders fire. */
export const ReminderSettings = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  enabled: z.boolean(),
  /** Local time on an all-day due date, in the workspace zone. */
  allDayTime: TimeOfDay,
  /** Minutes before a timed due date or event start. */
  timedOffsetMinutes: z.number().int().min(0).max(7 * 24 * 60),
  /** Desktop only: also show the operating system's notification. */
  nativeNotifications: z.boolean(),
});
export type ReminderSettings = z.infer<typeof ReminderSettings>;
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { schemaVersion: SCHEMA_VERSION, enabled: true, allDayTime: "09:00", timedOffsetMinutes: 60, nativeNotifications: true };
export const ReminderSettingsPatch = z.strictObject({
  enabled: z.boolean().optional(),
  allDayTime: TimeOfDay.optional(),
  timedOffsetMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  nativeNotifications: z.boolean().optional(),
});

/** `.nexus/calendar.json`: calendar events. Hein's slice writes it; reminders only read it. */
export const CalendarEvent = z.object({
  id: z.string().regex(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/),
  title: z.string().trim().min(1).max(200),
  start: Due.refine((d) => d !== null, "An event needs a start"),
  end: Due.optional(),
  /** false turns this event's reminder off. */
  reminder: z.boolean().optional(),
});
export const CalendarFile = z.object({ schemaVersion: z.literal(SCHEMA_VERSION), events: z.array(CalendarEvent) }).superRefine((file, ctx) => {
  // An event ID names one event: two rows with one ID would be one reminder key twice (R5-6).
  const seen = new Set<string>();
  file.events.forEach((e, i) => {
    if (seen.has(e.id)) ctx.addIssue({ code: "custom", path: ["events", i, "id"], message: "Another event in the file has the same ID" });
    seen.add(e.id);
  });
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;
export type CalendarFile = z.infer<typeof CalendarFile>;

/** One reminder occurrence's delivery, shared by every surface (DEC-009). */
export const Delivery = z.strictObject({
  id: z.string().regex(/^dlv_[0-9A-HJKMNP-TV-Z]{26}$/),
  /** Dedup key: kind, target ID, rule and scheduled instant. */
  key: z.string().min(1).max(300),
  kind: z.enum(["issue", "event", "test"]),
  targetId: z.string().nullable(),
  /** The issue key (NEX-1) or the event's month (2026-12), for showing and opening. */
  targetKey: z.string().nullable(),
  title: z.string().max(300),
  /** What the reminder says, for example "Due today at 09:00". */
  detail: z.string().max(300),
  workspaceId: z.string(),
  rule: z.string().max(40),
  scheduledAt: IsoInstant,
  status: z.enum(["delivering", "delivered", "missed"]),
  deliveredAt: IsoInstant.nullable(),
  /** The start-up in which a missed reminder was recorded: "While you were away" shows only the current one. */
  batch: z.string().nullable(),
});
export type Delivery = z.infer<typeof Delivery>;
export const DeliveryLog = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Deliveries up to this instant have been seen in the Notifications list (the badge). */
  seenUpTo: IsoInstant.nullable(),
  deliveries: z.array(Delivery),
  /**
   * Occurrences at or before this instant may have been delivered without an entry here: their
   * entries were pruned, or the log was replaced after damage. They are never delivered or
   * recorded again, even if the clock goes back (R5-5, R5-6).
   */
  prunedUpTo: IsoInstant.optional(),
});
export type DeliveryLog = z.infer<typeof DeliveryLog>;

/** `.nexus/state/scheduler.json`: the end of the last period in which Nexus was delivering. */
export const SchedulerState = z.strictObject({ schemaVersion: z.literal(SCHEMA_VERSION), lastTickAt: IsoInstant.nullable() });
export type SchedulerState = z.infer<typeof SchedulerState>;

/**
 * A record the scheduler skipped, so that it has no reminder (R5-4). The others are unaffected.
 * `record` is an event ID or an issue key; null when the whole file is affected.
 */
export interface ReminderProblem { file: string; record: string | null; message: string }

/** The error details when the delivery log is damaged: GET /notifications and the test reminder fail with them (R5-5). */
export interface DamagedLogDetails { file: ".nexus/state/deliveries.json"; recovery: "replace-delivery-log" }

/** What GET /notifications returns. */
export interface NotificationsView {
  deliveries: Delivery[];
  /** Missed reminders recorded in this start-up ("While you were away"). */
  away: Delivery[];
  unseen: number;
  settings: ReminderSettings;
  native: { available: boolean; reason: string | null } | null;
  workspaceId: string;
  /** Records skipped by the scheduler, each named with its file. */
  problems: ReminderProblem[];
}
