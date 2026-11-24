// Change-review journal (architecture 7.2, DEC-012).
import { z } from "zod";

// Defined locally (not imported from ./index) to avoid an import cycle, because index re-exports this module.
const SCHEMA_VERSION = 1 as const;
const IsoInstant = z.iso.datetime({ offset: false });

export const ChangeState = z.enum(["prepared", "pending", "accepted", "rejecting", "rejected", "conflicted", "superseded"]);
export const ConflictReason = z.enum(["missing", "ambiguous", "changed", "changed-before-apply"]);
export const ChangeKind = z.enum(["note.replaceSpan", "record.updateField"]);
export const RecordField = z.enum(["title", "description", "status", "priority", "due"]);
export const Actor = z.enum(["agent", "demo", "user", "system"]);

export const SpanContext = z.strictObject({ lineBefore: z.string().nullable(), lineAfter: z.string().nullable() });

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
