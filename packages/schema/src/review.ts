// Change-review journal (architecture 7.2, DEC-012).
import { z } from "zod";

// Defined locally (not imported from ./index) to avoid an import cycle, because index re-exports this module.
const SCHEMA_VERSION = 1 as const;
const IsoInstant = z.iso.datetime({ offset: false });

export const ChangeState = z.enum(["prepared", "pending", "accepted", "rejecting", "rejected", "conflicted", "superseded"]);
export const ConflictReason = z.enum(["missing", "ambiguous", "changed", "changed-before-apply"]);
/** record.create adds a new issue; record.addLink adds one noteLinks entry (architecture 7.1). */
export const ChangeKind = z.enum(["note.replaceSpan", "record.updateField", "record.create", "record.addLink"]);

// Local copies of the issue shapes the operations need (index.ts re-exports this module).
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DueValue = z.union([z.null(), z.strictObject({ date: LocalDate }), z.strictObject({ dateTime: IsoInstant, timeZone: z.string().min(1) })]);
const LinkValue = z.strictObject({ notePath: z.string().min(1).max(512), headingSlug: z.string().max(200).nullable(), headingText: z.string().max(300).nullable() });
/** `{{issue:<opId>}}` in a note edit stands for the key of the issue that operation creates. */
export const ISSUE_REF = /\{\{issue:([^{}]{1,120})\}\}/g;
export const RecordField = z.enum(["title", "description", "status", "priority", "due"]);
export const Actor = z.enum(["agent", "demo", "user", "system"]);

export const SpanContext = z.strictObject({ lineBefore: z.string().nullable(), lineAfter: z.string().nullable() });
/**
 * One section of a note on disk (null: the whole note) and the SHA-256 of its text as read.
 * Since run 6, `lines` names the exact lines a read returned, counted from the heading line
 * (0) or from the top of the note, and the hash covers those raw lines, heading line included
 * (R5-8). Scopes saved before run 6 have no `lines`: their hash covers the trimmed body.
 */
export const Scope = z.strictObject({
  headingSlug: z.string().max(200).nullable(),
  sectionHash: z.string().min(1),
  lines: z.strictObject({ from: z.number().int().min(0), count: z.number().int().min(1) }).optional(),
});

export const ChangeRecord = z.strictObject({
  changeId: z.string().regex(/^chg_[0-9A-HJKMNP-TV-Z]{26}$/),
  opId: z.string().min(1).max(120),
  kind: ChangeKind,
  file: z.string().min(1),
  target: z.strictObject({ recordId: z.string().nullable(), recordKey: z.string().nullable(), field: RecordField.nullable() }),
  baseRevision: z.union([z.string(), z.number().int()]),
  before: z.unknown(),
  after: z.unknown(),
  context: SpanContext.nullable(),
  dependsOn: z.array(z.string()),
  supersedes: z.string().nullable(),
  state: ChangeState,
  conflictReason: ConflictReason.nullable(),
  reversal: z.strictObject({ beforeHash: z.string(), afterHash: z.string(), at: IsoInstant }).nullable(),
  feedback: z.strictObject({ text: z.string().max(2000), at: IsoInstant }).nullable(),
  history: z.array(z.strictObject({ state: ChangeState, at: IsoInstant, by: Actor, note: z.string().nullable() })),
  // Added in run 5. Older journals have none of these fields.
  /** A note edit limited to one section on disk, whose text had this hash when it was read (R4-1). */
  scope: Scope.nullable().optional(),
  /**
   * A decision the user confirmed for a group of related changes, saved before the first one
   * is carried out, so that recovery can finish it after a crash (R4-9).
   */
  decision: z.strictObject({ action: z.enum(["accept", "reject"]), group: z.array(z.string()), at: IsoInstant }).nullable().optional(),
  /** Heading slugs that moved when this change was decided, for saved heading links (R4-8). */
  slugMoves: z.strictObject({
    ref: z.enum(["accepted", "disk"]),
    at: IsoInstant,
    moves: z.array(z.strictObject({ from: z.string(), to: z.string(), toText: z.string() })),
  }).nullable().optional(),
});

export const FileEntry = z.strictObject({
  path: z.string().min(1),
  beforeHash: z.string(),
  afterHash: z.string(),
  /** failed: the write did not happen (Retry or Discard). discarded: the user dropped its unapplied changes. */
  state: z.enum(["planned", "written", "failed", "conflicted", "discarded"]),
  error: z.string().nullable(),
  /** Timestamp used for record `updatedAt` when this file's content is (re)computed; defaults to the run's createdAt. */
  appliedAt: IsoInstant.nullable().optional(),
});

export const ReviewRun = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().regex(/^run_[0-9A-HJKMNP-TV-Z]{26}$/),
  source: z.strictObject({
    kind: z.enum(["agent", "fixed-demo"]),
    label: z.string().min(1).max(120),
    conversationId: z.string().nullable(),
    model: z.string().nullable(),
  }),
  createdAt: IsoInstant,
  phase: z.enum(["prepared", "applying", "applied", "partial"]),
  files: z.array(FileEntry),
  changes: z.array(ChangeRecord),
});

/** Proposal operations. Validated, then journaled, then applied. */
export const ProposedOperation = z.discriminatedUnion("kind", [
  z.strictObject({
    opId: z.string().min(1).max(120),
    kind: z.literal("note.replaceSpan"),
    file: z.string().min(1).max(512),
    baseRevision: z.string().min(1),
    before: z.string().min(1).max(20_000),
    after: z.string().max(20_000),
    /** opIds of operations in the same proposal this edit depends on (implied by {{issue:…}}). */
    dependsOn: z.array(z.string().min(1).max(120)).max(10).optional(),
    /** Limit the edit to this section, and only while it still has the text that was read. */
    scope: Scope.optional(),
  }),
  z.strictObject({
    opId: z.string().min(1).max(120),
    kind: z.literal("record.create"),
    file: z.literal(".nexus/issues.json"),
    projectKey: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20_000).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    due: DueValue.optional(),
  }),
  z.strictObject({
    opId: z.string().min(1).max(120),
    kind: z.literal("record.addLink"),
    file: z.literal(".nexus/issues.json"),
    /** An existing issue, or the opId of a record.create in the same proposal. */
    recordKey: z.string().min(1).optional(),
    issueRef: z.string().min(1).max(120).optional(),
    baseRevision: z.number().int().positive().optional(),
    link: LinkValue,
  }),
  z.strictObject({
    opId: z.string().min(1).max(120),
    kind: z.literal("record.updateField"),
    file: z.literal(".nexus/issues.json"),
    recordKey: z.string().min(1),
    field: RecordField,
    baseRevision: z.number().int().positive(),
    before: z.unknown(),
    after: z.unknown(),
  }),
]);

export const FeedbackRequest = z.strictObject({ text: z.string().trim().min(1).max(2000) });

export type ChangeState = z.infer<typeof ChangeState>;
export type ChangeRecord = z.infer<typeof ChangeRecord>;
export type FileEntry = z.infer<typeof FileEntry>;
export type ReviewRun = z.infer<typeof ReviewRun>;
export type ProposedOperation = z.infer<typeof ProposedOperation>;
export type RecordField = z.infer<typeof RecordField>;

export const OPEN_STATES: readonly ChangeState[] = ["prepared", "pending", "rejecting", "conflicted"];

/** What the UI needs to show and navigate to a change. */
export interface ChangeView {
  changeId: string;
  runId: string;
  sourceKind: "agent" | "fixed-demo";
  sourceLabel: string;
  kind: ChangeRecord["kind"];
  file: string;
  state: ChangeState;
  conflictReason: ChangeRecord["conflictReason"];
  recordKey: string | null;
  field: RecordField | null;
  before: unknown;
  after: unknown;
  /** Current zero-based line range of the span in the note, when it can be located. */
  lines: { start: number; end: number } | null;
  current: unknown;
  feedback: string | null;
  summary: string;
  /** Actual outcome of this change's file write in its run. */
  fileState: FileEntry["state"];
  fileError: string | null;
  runPhase: ReviewRun["phase"];
  /** Changes this one needs (for example the issue a link points to), and those that need it. */
  dependsOn: string[];
  dependents: string[];
}

/** What a proposal or retry actually did, file by file. */
export interface RunOutcome {
  runId: string | null;
  phase: ReviewRun["phase"] | null;
  files: Array<{ path: string; state: FileEntry["state"]; error: string | null }>;
  changes: ChangeView[];
  duplicates: string[];
  /** True when every operation had already been proposed: nothing new was written. */
  repeated: boolean;
}
