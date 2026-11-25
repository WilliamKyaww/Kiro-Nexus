// Shared data model and API contracts (B1). See docs/data-format.md.
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

const ulidBody = "[0-9A-HJKMNP-TV-Z]{26}";
export const prefixedId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_${ulidBody}$`), `Expected a ${prefix}_ ID`);

export const ProjectKey = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, "Use 2-10 capital letters or digits, starting with a letter");
export const IssueKey = z.string().regex(/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$/);
export const IssueStatus = z.enum(["todo", "in_progress", "done"]);
export const IssuePriority = z.enum(["low", "medium", "high", "urgent"]);
export const IsoInstant = z.iso.datetime({ offset: false });
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const Due = z.union([
  z.null(),
  z.strictObject({ date: LocalDate }),
  z.strictObject({ dateTime: IsoInstant, timeZone: z.string().min(1) }),
]);

export const NoteLink = z.strictObject({
  notePath: z.string().min(1).max(512),
  headingSlug: z.string().max(200).nullable(),
  headingText: z.string().max(300).nullable(),
});

export const WorkspaceManifest = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  workspaceId: prefixedId("wsp"),
  name: z.string().min(1).max(120),
  timeZone: z.string().min(1),
  createdAt: IsoInstant,
});

export const Project = z.strictObject({
  id: prefixedId("prj"),
  key: ProjectKey,
  name: z.string().min(1).max(120),
  nextIssueNumber: z.number().int().positive(),
  createdAt: IsoInstant,
  updatedAt: IsoInstant,
  revision: z.number().int().positive(),
});

export const ProjectsFile = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  projects: z.array(Project),
});

export const Issue = z.strictObject({
  id: prefixedId("iss"),
  key: IssueKey,
  projectId: prefixedId("prj"),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000),
  status: IssueStatus,
  priority: IssuePriority,
  due: Due,
  rank: z.string().min(1),
  noteLinks: z.array(NoteLink).max(50),
  createdAt: IsoInstant,
  updatedAt: IsoInstant,
  revision: z.number().int().positive(),
});

export const IssuesFile = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  issues: z.array(Issue),
});

export type Due = z.infer<typeof Due>;
export type NoteLink = z.infer<typeof NoteLink>;
export type WorkspaceManifest = z.infer<typeof WorkspaceManifest>;
export type Project = z.infer<typeof Project>;
export type ProjectsFile = z.infer<typeof ProjectsFile>;
export type Issue = z.infer<typeof Issue>;
export type IssuesFile = z.infer<typeof IssuesFile>;
export type IssueStatus = z.infer<typeof IssueStatus>;
export type IssuePriority = z.infer<typeof IssuePriority>;

/**
 * Deterministic JSON: parsing through the schema fixes key order, then
 * two-space indentation and a trailing LF. DEC-012 relies on this being
 * byte-stable so that recomputed results hash identically.
 */
export function serialise<T>(schema: z.ZodType<T>, value: unknown): string {
  return JSON.stringify(schema.parse(value), null, 2) + "\n";
}

// ---------- API request bodies ----------

export const SessionRequest = z.strictObject({ launchCode: z.string().min(16).max(64) });
export const OpenWorkspaceRequest = z.strictObject({ path: z.string().min(1).max(1024) });
export const SampleWorkspaceRequest = z.strictObject({ targetPath: z.string().min(1).max(1024) });
export const CreateNoteRequest = z.strictObject({ path: z.string().min(1).max(512), content: z.string().max(2_000_000) });
export const SaveNoteRequest = z.strictObject({
  path: z.string().min(1).max(512),
  content: z.string().max(2_000_000),
  baseRevision: z.string().min(1),
});
export const CreateProjectRequest = z.strictObject({ key: ProjectKey, name: z.string().min(1).max(120) });
export const CreateIssueRequest = z.strictObject({
  projectId: prefixedId("prj"),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  status: IssueStatus.optional(),
  priority: IssuePriority.optional(),
  due: Due.optional(),
  noteLinks: z.array(NoteLink).max(50).optional(),
});
export const IssuePatch = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  status: IssueStatus.optional(),
  priority: IssuePriority.optional(),
  due: Due.optional(),
  noteLinks: z.array(NoteLink).max(50).optional(),
});
/**
 * `baseValues` are the patched fields' values when the edit began. With them, a
 * stale `baseRevision` is merged field by field: fields nobody else changed are
 * applied on top of newer edits; a field changed by someone else is a conflict.
 */
export const UpdateIssueRequest = z.strictObject({ baseRevision: z.number().int().positive(), patch: IssuePatch, baseValues: IssuePatch.optional() });

export type IssuePatch = z.infer<typeof IssuePatch>;

// ---------- API response shapes ----------

export interface HeadingInfo { depth: number; text: string; slug: string; line: number }
export type LinkStatus = "ok" | "heading-missing" | "note-missing";
export interface ResolvedNoteLink extends NoteLink { status: LinkStatus; resolvedSlug: string | null }
export interface IssueView extends Issue { projectKey: string; links: ResolvedNoteLink[] }
export interface NoteView {
  path: string;
  content: string;
  revision: string;
  headings: HeadingInfo[];
  linkedIssues: Array<{ key: string; title: string; status: IssueStatus; headingSlug: string | null; headingText: string | null; linkStatus: LinkStatus }>;
}
export interface WorkspaceView {
  workspace: null | { root: string; name: string; workspaceId: string; timeZone: string };
  recent: Array<{ path: string; openedAt: string }>;
  openError: null | { code: string; message: string };
}
export interface ApiErrorBody { error: { code: string; message: string; details?: unknown } }

export * from "./review";
export * from "./time";
export * from "./reminders";
export * from "./appearance";
