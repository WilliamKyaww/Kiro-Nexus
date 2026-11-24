// Edit mode's one write tool (DEC-008, PRD-051). The model proposes typed operations; Nexus maps
// them to journal operations, fills base revisions and current values itself, and writes them
// tentatively through the review engine. Nothing is final until the user accepts it, and the
// model has no way to accept anything.
import { z } from "zod";
import type { ProposedOperation, RecordField } from "@nexus/schema";
import type { ReadOnlyWorkspace } from "./tools";

const Ref = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
export const AgentOperation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create_issue"), ref: Ref, project: z.string().max(10), title: z.string().trim().min(1).max(200), description: z.string().max(5000).nullable().optional(), priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional() }),
  z.object({ op: z.literal("link_issue"), issue: z.string().min(1).max(40), note: z.string().min(1).max(512), heading: z.string().max(200).nullable().optional() }),
  z.object({ op: z.literal("edit_note"), note: z.string().min(1).max(512), before: z.string().min(1).max(5000), after: z.string().max(5000) }),
  z.object({ op: z.literal("update_issue"), issue: z.string().min(1).max(40), field: z.enum(["title", "description", "status", "priority", "due"]), value: z.unknown() }),
]);
export const ProposeArgs = z.object({ operations: z.array(AgentOperation).min(1).max(12), summary: z.string().max(500).optional() });
export type AgentOperation = z.infer<typeof AgentOperation>;

const str = { type: "string" };
export const PROPOSE_TOOL = {
  type: "function" as const,
  function: {
    name: "propose_changes",
    description: "Edit mode only. Propose changes to notes and issues. Nexus writes them tentatively and the user reviews each one; you cannot accept them. "
      + "create_issue makes a new issue (give it a ref). link_issue links an issue (its key, or the ref of an issue created in this call) to a note heading (the heading slug). "
      + "edit_note replaces exact whole lines of a note (before must match the note's current lines exactly once); in after, {{issue:<ref>}} becomes the new issue's key. "
      + "update_issue sets one field of an existing issue.",
    parameters: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["create_issue", "link_issue", "edit_note", "update_issue"] },
              ref: str, project: str, title: str, description: { type: ["string", "null"] }, priority: { type: ["string", "null"], enum: ["low", "medium", "high", "urgent", null] },
              issue: str, note: str, heading: { type: ["string", "null"] }, before: str, after: str,
              field: { type: "string", enum: ["title", "description", "status", "priority", "due"] }, value: {},
            },
            required: ["op"],
          },
        },
        summary: str,
      },
      required: ["operations"],
    },
  },
};

export const EDIT_SYSTEM = [
  "You are in Edit mode for this run, because the user chose Edit. You may propose changes with propose_changes.",
  "Nexus writes proposed changes to the files tentatively, and the user accepts or rejects each one. You cannot accept changes, and you must not claim that they are done.",
  "Read the note section first and use its exact lines in edit_note. When you create an issue for an action, link it to the heading the action is under, and mention the new key in the note line with {{issue:<ref>}}.",
  "After proposing, call final_answer with a short summary in suggestions of what you proposed and why.",
].join("\n");

/**
 * Map the model's operations to journal operations. Base revisions and current values come
 * from the workspace now, never from the model, so a stale or invented value cannot be written.
 */
export async function toProposedOperations(ops: AgentOperation[], ws: ReadOnlyWorkspace, opPrefix: string): Promise<{ operations: ProposedOperation[] } | { error: string }> {
  const refToOp = new Map<string, string>();
  ops.forEach((o, i) => { if (o.op === "create_issue") refToOp.set(o.ref, `${opPrefix}-${i + 1}`); });
  const issues = ws.issues();
  const out: ProposedOperation[] = [];
  for (const [i, o] of ops.entries()) {
    const opId = `${opPrefix}-${i + 1}`;
    if (o.op === "create_issue") {
      out.push({ opId, kind: "record.create", file: ".nexus/issues.json", projectKey: o.project.toUpperCase(), title: o.title, ...(o.description ? { description: o.description } : {}), ...(o.priority ? { priority: o.priority } : {}) });
    } else if (o.op === "link_issue") {
      const ref = refToOp.get(o.issue);
      const existing = issues.find((x) => x.key === o.issue.toUpperCase());
      if (!ref && !existing) return { error: `Operation ${i + 1}: no issue ${o.issue}, and no create_issue with that ref.` };
      out.push({ opId, kind: "record.addLink", file: ".nexus/issues.json", ...(ref ? { issueRef: ref } : { recordKey: existing!.key, baseRevision: existing!.revision }), link: { notePath: o.note, headingSlug: o.heading ?? null, headingText: null } });
    } else if (o.op === "edit_note") {
      const raw = await ws.readNote(o.note);
      if (!raw) return { error: `Operation ${i + 1}: note not found: ${o.note}` };
      const after = o.after.replace(/\{\{issue:([^{}]+)\}\}/g, (m, ref: string) => (refToOp.has(ref) ? `{{issue:${refToOp.get(ref)}}}` : m));
      out.push({ opId, kind: "note.replaceSpan", file: raw.path, baseRevision: raw.revision, before: o.before, after });
    } else {
      const issue = issues.find((x) => x.key === o.issue.toUpperCase());
      if (!issue) return { error: `Operation ${i + 1}: no issue ${o.issue}.` };
      out.push({ opId, kind: "record.updateField", file: ".nexus/issues.json", recordKey: issue.key, field: o.field as RecordField, baseRevision: issue.revision, before: issue[o.field as RecordField], after: o.value });
    }
  }
  return { operations: out };
}
