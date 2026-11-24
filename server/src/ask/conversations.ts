// Conversations: .nexus/conversations/<id>.json (schema v1), written through WorkspaceService.
// They hold questions, validated answers and run metadata; never keys.
import { z } from "zod";
import { NexusError } from "../errors";
import { newId, type WorkspaceService } from "../workspace/service";

const Item = z.object({ text: z.string(), sources: z.array(z.string()), unsupported: z.boolean().optional(), qualifier: z.string().optional() });
const Citation = z.object({
  handle: z.string(),
  label: z.string(),
  target: z.union([
    z.object({ kind: z.literal("note"), path: z.string(), headingSlug: z.string().nullable(), headingText: z.string().nullable() }),
    z.object({ kind: z.literal("issue"), key: z.string() }),
  ]),
});
export const StoredAnswer = z.object({
  facts: z.array(Item), discrepancies: z.array(Item), suggestions: z.array(Item),
  // Added in the corrective pass; older conversation files have no such list.
  unconfirmed: z.array(Item).default([]),
  // Added in run 4: structured tracking claims and whether the evidence confirmed them.
  tracking: z.array(z.object({
    action: z.string(), source: z.string(), status: z.enum(["tracked", "untracked"]), issues: z.array(z.string()),
    reason: z.string(), confirmed: z.boolean(), problem: z.string().nullable(),
  })).default([]),
  insufficientEvidence: z.boolean(), insufficientReason: z.string().nullable(),
  citations: z.record(z.string(), Citation), removedCitations: z.number(), demoted: z.number(),
});
export const Message = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  at: z.string(),
  runId: z.string().nullable(),
  text: z.string().nullable(),
  status: z.enum(["complete", "running", "failed", "cancelled"]),
  answer: StoredAnswer.nullable(),
  meta: z.object({
    profileName: z.string(), model: z.string(), receivingHost: z.string(), mode: z.string(), fixture: z.boolean(),
    scopeNote: z.string(), steps: z.number(), rejectedToolCalls: z.array(z.string()), plainReplyIgnored: z.boolean(),
    // Added in the corrective pass: earlier turns given to the model as context.
    contextTurns: z.number().optional(),
  }).nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  // Added in run 4 (Edit mode). Older files have neither field: those turns were Ask turns.
  authority: z.enum(["ask", "edit"]).optional(),
  edit: z.object({
    reviewRunId: z.string().nullable(),
    phase: z.string().nullable(),
    changes: z.array(z.object({ changeId: z.string(), kind: z.string(), summary: z.string(), recordKey: z.string().nullable(), file: z.string(), state: z.string(), dependsOn: z.array(z.string()) })),
    failedFiles: z.array(z.object({ path: z.string(), error: z.string().nullable() })),
  }).nullable().optional(),
});
export const Conversation = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(Message),
});
export type Conversation = z.infer<typeof Conversation>;
export type Message = z.infer<typeof Message>;

/** Read-modify-write of one conversation file runs one at a time, per workspace. */
const queues = new WeakMap<WorkspaceService, Map<string, Promise<unknown>>>();

export class ConversationStore {
  constructor(private readonly service: WorkspaceService) {}

  async save(c: Conversation): Promise<void> {
    await this.service.writeConversation(c.id, JSON.stringify(Conversation.parse(c), null, 2) + "\n");
  }

  /**
   * Read the conversation, apply `mutate` and write it back, after any earlier update of the
   * same conversation has finished, so that concurrent updates never overwrite each other.
   */
  async update<T>(id: string, mutate: (c: Conversation) => T | Promise<T>): Promise<T> {
    let byId = queues.get(this.service);
    if (!byId) { byId = new Map(); queues.set(this.service, byId); }
    const previous = byId.get(id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const c = await this.get(id);
      const result = await mutate(c);
      await this.save(c);
      return result;
    });
    byId.set(id, run);
    try {
      return await run;
    } finally {
      if (byId.get(id) === run) byId.delete(id);
    }
  }

  async get(id: string): Promise<Conversation> {
    const raw = await this.service.readConversation(id);
    if (!raw) throw new NexusError("NOT_FOUND", "That conversation does not exist.");
    try {
      return Conversation.parse(JSON.parse(raw));
    } catch {
      throw new NexusError("INVALID_DATA", "The conversation file could not be read.");
    }
  }

  async create(title: string): Promise<Conversation> {
    const at = new Date().toISOString();
    const c: Conversation = { schemaVersion: 1, id: newId("cnv"), title: title.slice(0, 120) || "New conversation", createdAt: at, updatedAt: at, messages: [] };
    await this.save(c);
    return c;
  }

  async list(): Promise<Array<{ id: string; title: string; updatedAt: string; messages: number }>> {
    const out = [];
    for (const id of await this.service.listConversationIds()) {
      try {
        const c = await this.get(id);
        out.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages.length });
      } catch { /* skip unreadable */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
