// WorkspaceService: the only reader and writer of workspace files (DEC-005, R-C6).
import { EventEmitter } from "node:events";
import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { monotonicFactory } from "ulid";
import type { z } from "zod";
import {
  IssuesFile, ProjectsFile, SCHEMA_VERSION, WorkspaceManifest, serialise,
  type Issue, type IssuePatch, type IssueView, type NoteLink, type NoteView, type Project,
  type ResolvedNoteLink,
} from "@nexus/schema";
import { parseHeadings, resolveHeading } from "@nexus/markdown";
import { NexusError, isNodeError } from "../errors";
import { atomicWrite, createExclusive, sha256 } from "./atomic";
import { acquireLock, releaseLock, type LockInfo } from "./lock";
import { assertInsideRealRoot, resolveNotePath } from "./paths";

const ulid = monotonicFactory();
export const newId = (prefix: string) => `${prefix}_${ulid()}`;
const now = () => new Date().toISOString();

type CollectionName = "workspace" | "projects" | "issues";
const collectionFiles: Record<CollectionName, string> = {
  workspace: "workspace.json",
  projects: "projects.json",
  issues: "issues.json",
};

export interface ChangeEvent {
  type: "file.changed";
  path: string;
  source: "nexus" | "external";
  revision: string | null;
}

export interface OpenOptions {
  lock: LockInfo;
  /** Called once with the previous holder when a stale lock is taken over. */
  onLockTakeover?: (previous: LockInfo) => void;
}

export class WorkspaceService {
  readonly events = new EventEmitter();
  private queue: Promise<unknown> = Promise.resolve();
  private diskHash: Partial<Record<CollectionName, string>> = {};
  private closed = false;

  private constructor(
    readonly root: string,
    private readonly lock: LockInfo,
    public manifest: WorkspaceManifest,
    private projects: ProjectsFile,
    private issues: IssuesFile,
  ) {}

  /** Open (initialising if needed) and take the single-writer lock. */
  static async open(rootInput: string, options: OpenOptions): Promise<WorkspaceService> {
    const root = resolve(rootInput);
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) throw new NexusError("NOT_FOUND", `Workspace folder not found: ${root}`);
    const dataDir = join(root, ".nexus");
    await mkdir(dataDir, { recursive: true });
    const { takenOverFrom } = await acquireLock(root, options.lock);
    if (takenOverFrom) options.onLockTakeover?.(takenOverFrom);
    try {
      const hashes: Partial<Record<CollectionName, string>> = {};
      const load = async <T>(name: CollectionName, schema: z.ZodType<T>, initial: () => T): Promise<T> => {
        const file = join(dataDir, collectionFiles[name]);
        let raw: Buffer;
        try {
          raw = await readFile(file);
        } catch (e) {
          if (!isNodeError(e) || e.code !== "ENOENT") throw e;
          const bytes = serialise(schema, initial());
          await createExclusive(file, bytes);
          hashes[name] = sha256(bytes);
          return schema.parse(JSON.parse(bytes));
        }
        hashes[name] = sha256(raw);
        return parseCollection(name, schema, raw.toString("utf8"));
      };
      const manifest = await load("workspace", WorkspaceManifest, () => ({
        schemaVersion: SCHEMA_VERSION,
        workspaceId: newId("wsp"),
        name: basename(root) || "Workspace",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        createdAt: now(),
      }));
      const projects = await load("projects", ProjectsFile, () => ({ schemaVersion: SCHEMA_VERSION, projects: [] }));
      const issues = await load("issues", IssuesFile, () => ({ schemaVersion: SCHEMA_VERSION, issues: [] }));
      const service = new WorkspaceService(root, options.lock, manifest, projects, issues);
      service.diskHash = hashes;
      return service;
    } catch (e) {
      await releaseLock(root, options.lock.instanceId);
      throw e;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.queue.catch(() => undefined);
    await releaseLock(this.root, this.lock.instanceId);
  }

  /** Serialise mutations so read-modify-write sequences never interleave. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new NexusError("NO_WORKSPACE", "The workspace is closed."));
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(event: ChangeEvent): void {
    this.events.emit("change", event);
  }

  // ---------------- Notes ----------------

  notePath(rel: string) {
    return resolveNotePath(this.root, rel);
  }

  async listNotes(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 12 || out.length > 10_000) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs, depth + 1);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(relative(this.root, abs).split(sep).join("/"));
      }
    };
    await walk(this.root, 0);
    return out.sort((a, b) => a.localeCompare(b, "en-GB"));
  }

  /** Raw bytes as text plus revision, or null if the note does not exist. */
  async readNoteRaw(rel: string): Promise<{ rel: string; content: string; revision: string } | null> {
    const { rel: norm, abs } = this.notePath(rel);
    try {
      const bytes = await readFile(abs);
      return { rel: norm, content: bytes.toString("utf8"), revision: sha256(bytes) };
    } catch (e) {
      if (isNodeError(e) && (e.code === "ENOENT" || e.code === "EISDIR")) return null;
      throw e;
    }
  }

  async readNote(rel: string): Promise<NoteView> {
    const raw = await this.readNoteRaw(rel);
    if (!raw) throw new NexusError("NOT_FOUND", `Note not found: ${rel}`);
    const headings = parseHeadings(raw.content);
    return {
      path: raw.rel,
      content: raw.content,
      revision: raw.revision,
      headings,
      linkedIssues: this.issues.issues
        .filter((i) => i.noteLinks.some((l) => l.notePath === raw.rel))
        .flatMap((i) => i.noteLinks.filter((l) => l.notePath === raw.rel).map((l) => {
          const resolved = resolveHeading(headings, l.headingSlug, l.headingText);
          return { key: i.key, title: i.title, status: i.status, headingSlug: resolved.slug ?? l.headingSlug, headingText: l.headingText, linkStatus: resolved.status };
        })),
    };
  }

  async createNote(rel: string, content: string): Promise<NoteView> {
    return this.exclusive(async () => {
      const { rel: norm, abs } = this.notePath(rel);
      await assertInsideRealRoot(this.root, abs);
      try {
        await createExclusive(abs, content);
      } catch (e) {
        if (isNodeError(e) && e.code === "EEXIST") throw new NexusError("EXISTS", `A note already exists at ${norm}`);
        throw e;
      }
      this.emit({ type: "file.changed", path: norm, source: "nexus", revision: sha256(content) });
      return this.readNote(norm);
    });
  }

  /**
   * Save a note if, and only if, the file on disk still has `baseRevision`.
   * A stale save writes nothing and returns the current content (PRD-023).
   */
  async saveNote(rel: string, content: string, baseRevision: string): Promise<NoteView> {
    return this.exclusive(async () => {
      const current = await this.readNoteRaw(rel);
      if (!current) throw new NexusError("NOT_FOUND", `Note not found: ${rel}`);
      if (current.revision !== baseRevision) {
        throw new NexusError("REVISION_MISMATCH", "This note changed since you opened it.", {
          current: { content: current.content, revision: current.revision },
        });
      }
      const bytes = preserveLineEndings(current.content, content);
      await this.writeNoteUnlocked(current.rel, bytes);
      return this.readNote(current.rel);
    });
  }

  /** Write note bytes. Callers must hold `exclusive` and have validated the base revision. */
  async writeNoteUnlocked(rel: string, content: string): Promise<string> {
    const { rel: norm, abs } = this.notePath(rel);
    await assertInsideRealRoot(this.root, abs);
    try {
      await atomicWrite(abs, content);
    } catch (e) {
      throw new NexusError("WRITE_FAILED", `Could not save ${norm}: ${(e as Error).message}`);
    }
    const revision = sha256(content);
    this.emit({ type: "file.changed", path: norm, source: "nexus", revision });
    return revision;
  }

  // ---------------- Collections ----------------

  collectionPath(name: CollectionName): string {
    return join(this.root, ".nexus", collectionFiles[name]);
  }

  /**
   * Write a JSON collection atomically after checking that nobody changed it
   * on disk since we last read or wrote it. A changed file is reloaded and the
   * write is refused, protecting the newer data.
   */
  async writeCollectionUnlocked<T>(name: CollectionName, schema: z.ZodType<T>, value: unknown): Promise<T> {
    const file = this.collectionPath(name);
    const onDisk = await readFile(file).catch(() => null);
    if (onDisk && this.diskHash[name] && sha256(onDisk) !== this.diskHash[name]) {
      this.reloadCollection(name, onDisk);
      throw new NexusError("REVISION_MISMATCH", `${collectionFiles[name]} changed on disk outside Nexus. Nexus reloaded it; please retry.`);
    }
    const bytes = serialise(schema, value);
    try {
      if (onDisk) await atomicWrite(file + ".bak", onDisk);
      await atomicWrite(file, bytes);
    } catch (e) {
      throw new NexusError("WRITE_FAILED", `Could not write ${collectionFiles[name]}: ${(e as Error).message}`);
    }
    this.diskHash[name] = sha256(bytes);
    const parsed = schema.parse(JSON.parse(bytes));
    if (name === "projects") this.projects = parsed as ProjectsFile;
    if (name === "issues") this.issues = parsed as IssuesFile;
    if (name === "workspace") this.manifest = parsed as WorkspaceManifest;
    this.emit({ type: "file.changed", path: `.nexus/${collectionFiles[name]}`, source: "nexus", revision: this.diskHash[name] ?? null });
    return parsed;
  }

  private reloadCollection(name: CollectionName, bytes: Buffer): void {
    const text = bytes.toString("utf8");
    if (name === "projects") this.projects = parseCollection(name, ProjectsFile, text);
    if (name === "issues") this.issues = parseCollection(name, IssuesFile, text);
    if (name === "workspace") this.manifest = parseCollection(name, WorkspaceManifest, text);
    this.diskHash[name] = sha256(bytes);
  }

  issuesSnapshot(): IssuesFile {
    return structuredClone(this.issues);
  }

  collectionHash(name: CollectionName): string | undefined {
    return this.diskHash[name];
  }

  /** Current bytes of a collection file, read from disk (not the cache). */
  async readCollectionBytes(name: CollectionName): Promise<Buffer> {
    return readFile(this.collectionPath(name));
  }

  // ---------------- Review journal ----------------

  journalDir(): string {
    return join(this.root, ".nexus", "reviews");
  }

  /** Persist a review journal record. Callers must hold `exclusive`. */
  async writeJournalUnlocked(runId: string, bytes: string): Promise<void> {
    if (!/^run_[0-9A-HJKMNP-TV-Z]{26}$/.test(runId)) throw new NexusError("VALIDATION", "Invalid run ID.");
    try {
      await atomicWrite(join(this.journalDir(), `${runId}.json`), bytes);
    } catch (e) {
      throw new NexusError("WRITE_FAILED", `Could not write the review journal: ${(e as Error).message}`);
    }
  }

  // ---------------- Projects and issues ----------------

  listProjects(): Project[] {
    return structuredClone(this.projects.projects);
  }

  async createProject(key: string, name: string): Promise<Project> {
    return this.exclusive(async () => {
      if (this.projects.projects.some((p) => p.key === key)) throw new NexusError("EXISTS", `Project key ${key} is already used.`);
      const t = now();
      const project: Project = { id: newId("prj"), key, name, nextIssueNumber: 1, createdAt: t, updatedAt: t, revision: 1 };
      await this.writeCollectionUnlocked("projects", ProjectsFile, { ...this.projects, projects: [...this.projects.projects, project] });
      return project;
    });
  }

  listIssues(projectId?: string): Issue[] {
    return structuredClone(this.issues.issues.filter((i) => !projectId || i.projectId === projectId));
  }

  async getIssue(key: string): Promise<IssueView> {
    const issue = this.issues.issues.find((i) => i.key === key || i.id === key);
    if (!issue) throw new NexusError("NOT_FOUND", `Issue not found: ${key}`);
    return this.viewIssue(issue);
  }

  private async viewIssue(issue: Issue): Promise<IssueView> {
    const project = this.projects.projects.find((p) => p.id === issue.projectId);
    const links: ResolvedNoteLink[] = [];
    for (const link of issue.noteLinks) links.push(await this.resolveLink(link));
    return { ...structuredClone(issue), projectKey: project?.key ?? "?", links };
  }

  async resolveLink(link: NoteLink): Promise<ResolvedNoteLink> {
    let raw: Awaited<ReturnType<WorkspaceService["readNoteRaw"]>> = null;
    try {
      raw = await this.readNoteRaw(link.notePath);
    } catch {
      raw = null;
    }
    if (!raw) return { ...link, status: "note-missing", resolvedSlug: null };
    const resolved = resolveHeading(parseHeadings(raw.content), link.headingSlug, link.headingText);
    return { ...link, status: resolved.status, resolvedSlug: resolved.slug };
  }

  async createIssue(input: {
    projectId: string; title: string; description?: string; status?: Issue["status"]; priority?: Issue["priority"];
    due?: Issue["due"]; noteLinks?: NoteLink[];
  }): Promise<IssueView> {
    return this.exclusive(async () => {
      const project = this.projects.projects.find((p) => p.id === input.projectId);
      if (!project) throw new NexusError("NOT_FOUND", "Project not found.");
      for (const link of input.noteLinks ?? []) this.notePath(link.notePath);
      // Derive the next number from both the counter and existing keys, so a
      // crash between the two file writes can never reuse a key.
      const used = this.issues.issues.filter((i) => i.projectId === project.id).map((i) => Number(i.key.split("-")[1]));
      const n = Math.max(project.nextIssueNumber, ...used.map((u) => u + 1), 1);
      const t = now();
      const issue: Issue = {
        id: newId("iss"), key: `${project.key}-${n}`, projectId: project.id, title: input.title,
        description: input.description ?? "", status: input.status ?? "todo", priority: input.priority ?? "medium",
        due: input.due ?? null, rank: String(n).padStart(8, "0"), noteLinks: input.noteLinks ?? [],
        createdAt: t, updatedAt: t, revision: 1,
      };
      await this.writeCollectionUnlocked("issues", IssuesFile, { ...this.issues, issues: [...this.issues.issues, issue] });
      const projects = this.projects.projects.map((p) => (p.id === project.id ? { ...p, nextIssueNumber: n + 1, updatedAt: t, revision: p.revision + 1 } : p));
      await this.writeCollectionUnlocked("projects", ProjectsFile, { ...this.projects, projects });
      return this.viewIssue(issue);
    });
  }

  async updateIssue(key: string, baseRevision: number, patch: IssuePatch): Promise<IssueView> {
    return this.exclusive(async () => {
      const current = this.issues.issues.find((i) => i.key === key || i.id === key);
      if (!current) throw new NexusError("NOT_FOUND", `Issue not found: ${key}`);
      if (current.revision !== baseRevision) {
        throw new NexusError("REVISION_MISMATCH", "This issue changed since you opened it.", { current: await this.viewIssue(current) });
      }
      for (const link of patch.noteLinks ?? []) this.notePath(link.notePath);
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const next: Issue = { ...current, ...defined, updatedAt: now(), revision: current.revision + 1 };
      await this.writeCollectionUnlocked("issues", IssuesFile, {
        ...this.issues,
        issues: this.issues.issues.map((i) => (i.id === current.id ? next : i)),
      });
      return this.viewIssue(next);
    });
  }
}

function parseCollection<T>(name: CollectionName, schema: z.ZodType<T>, text: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new NexusError("INVALID_DATA", `.nexus/${collectionFiles[name]} is not valid JSON. Nexus did not change it.`, { file: collectionFiles[name] });
  }
  const version = (json as { schemaVersion?: unknown })?.schemaVersion;
  if (typeof version === "number" && version > SCHEMA_VERSION) {
    throw new NexusError("INVALID_DATA", `.nexus/${collectionFiles[name]} was created by a newer Nexus (schema ${version}).`, { file: collectionFiles[name] });
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new NexusError("INVALID_DATA", `.nexus/${collectionFiles[name]} failed validation. Nexus did not change it.`, {
      file: collectionFiles[name],
      issues: result.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  return result.data;
}

/** Textareas normalise CRLF to LF; keep a CRLF file CRLF so only real edits change bytes. */
export function preserveLineEndings(previous: string, next: string): string {
  if (previous.includes("\r\n") && !next.includes("\r")) return next.replace(/\n/g, "\r\n");
  return next;
}

/** Copy the synthetic sample into an empty or new folder and give it a fresh identity. */
export async function copySampleWorkspace(sampleDir: string, targetInput: string): Promise<string> {
  const target = resolve(targetInput);
  const existing = await readdir(target).catch((e) => {
    if (isNodeError(e) && e.code === "ENOENT") return null;
    throw e;
  });
  if (existing && existing.length > 0) throw new NexusError("EXISTS", `The folder is not empty: ${target}`);
  await cp(sampleDir, target, { recursive: true, errorOnExist: true, force: false });
  const manifestPath = join(target, ".nexus", "workspace.json");
  const manifest = WorkspaceManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  await atomicWrite(manifestPath, serialise(WorkspaceManifest, { ...manifest, workspaceId: newId("wsp"), createdAt: now() }));
  return target;
}
