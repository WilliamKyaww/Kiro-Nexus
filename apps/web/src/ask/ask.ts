// Ask state shared by Home and the conversation page.
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeView } from "@nexus/schema";
import { api } from "../api";

export interface Citation {
  handle: string;
  label: string;
  target: { kind: "note"; path: string; headingSlug: string | null; headingText: string | null; excerpt?: string | null } | { kind: "issue"; key: string };
}
export interface AnswerItem { text: string; sources: string[]; unsupported?: boolean; qualifier?: string }
export interface TrackingEntry { action: string; source: string; status: "tracked" | "untracked"; issues: string[]; reason: string; confirmed: boolean; problem: string | null }
export interface StoredAnswer {
  facts: AnswerItem[]; discrepancies: AnswerItem[]; suggestions: AnswerItem[]; unconfirmed?: AnswerItem[]; tracking?: TrackingEntry[];
  insufficientEvidence: boolean; insufficientReason: string | null;
  citations: Record<string, Citation>; removedCitations: number; demoted: number;
}
export interface Message {
  id: string; role: "user" | "assistant"; at: string; runId: string | null; text: string | null;
  status: "complete" | "running" | "failed" | "cancelled";
  answer: StoredAnswer | null;
  meta: null | { profileName: string; model: string; receivingHost: string; mode: string; fixture: boolean; scopeNote: string; steps: number; rejectedToolCalls: string[]; plainReplyIgnored: boolean };
  error: null | { code: string; message: string };
  /** The run's authority. Absent in older conversations, whose turns were all Ask turns. */
  authority?: "ask" | "edit";
  /** Edit turns only: what the run proposed for review. */
  edit?: EditOutcome | null;
  /** A correction's turns: the rejected change they correct (R6-5). */
  correctionOf?: string;
}
export interface EditChange { changeId: string; kind: ChangeView["kind"]; summary: string; recordKey: string | null; file: string; state: string; dependsOn: string[] }
export interface EditOutcome { reviewRunId: string | null; phase: string | null; changes: EditChange[]; failedFiles: Array<{ path: string; error: string | null }> }
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[]; activeRun: string | null }
export interface AskStatus {
  available: boolean; reason: string | null; message: string | null;
  profile: null | { id: string; name: string; model: string; receivingHost: string; fixture: boolean };
  /** Edit needs a model that has shown tool calling. */
  edit?: { available: boolean; message: string | null };
}

export const askStatusKey = ["ask", "status"] as const;
export const useAskStatus = () => useQuery({ queryKey: askStatusKey, queryFn: () => api.get<AskStatus>("/ask/status") });
export const useConversations = () => useQuery({ queryKey: ["conversations"], queryFn: () => api.get<{ conversations: Array<{ id: string; title: string; updatedAt: string; messages: number }> }>("/conversations") });
export const useConversation = (id: string) => useQuery({ queryKey: ["conversation", id], queryFn: () => api.get<Conversation>(`/conversations/${encodeURIComponent(id)}`) });

// Live progress per run, fed by "ask.progress" events.
let progress: Record<string, string> = {};
const listeners = new Set<() => void>();
export function setProgress(runId: string, activity: string | null) {
  progress = { ...progress };
  if (activity === null) delete progress[runId]; else progress[runId] = activity;
  for (const l of listeners) l();
}
export const useProgress = (runId: string | null) =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => (runId ? progress[runId] ?? null : null));

/**
 * Edit runs started from this tab whose first change has not been opened yet. The conversation
 * page opens it once when the answer arrives, however quickly the run finishes.
 */
export const editRunsToOpen = new Set<string>();

/** Ask a question in an existing conversation, or a new one. Resolves to the conversation ID. */
export function useAsk() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ question, conversationId, mode = "ask" }: { question: string; conversationId?: string; mode?: "ask" | "edit" }) => {
      const id = conversationId ?? (await api.post<{ id: string }>("/conversations", {})).id;
      const started = await api.post<{ runId: string }>(`/conversations/${encodeURIComponent(id)}/ask`, { question, mode });
      if (mode === "edit") editRunsToOpen.add(started.runId);
      return id;
    },
    onSuccess: (id) => {
      void client.invalidateQueries({ queryKey: ["conversation", id] });
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
    // A busy reply (409) means another window's question is running here: show it. The typed
    // question stays in the composer, so it can be sent once that answer arrives.
    onError: (_error, { conversationId }) => {
      if (conversationId) void client.invalidateQueries({ queryKey: ["conversation", conversationId] });
    },
  });
}

export function cancelRun(runId: string) {
  return api.post(`/ask-runs/${encodeURIComponent(runId)}/cancel`);
}

/**
 * Where a citation leads. A note citation names a heading of the accepted text as it was when
 * the answer was given (`answeredAt`), so the link says so: the note page then follows any
 * heading moves since (R4-8).
 */
export function citationHref(c: Citation, conversationId: string, answeredAt?: string): string {
  const from = `&from=${encodeURIComponent(`/c/${conversationId}`)}`;
  if (c.target.kind === "issue") return `/issues/${encodeURIComponent(c.target.key)}?from=${encodeURIComponent(`/c/${conversationId}`)}`;
  const heading = c.target.headingSlug
    ? `&heading=${encodeURIComponent(c.target.headingSlug)}&ref=accepted${answeredAt ? `&at=${encodeURIComponent(answeredAt)}` : ""}${c.target.excerpt ? `&excerpt=${encodeURIComponent(c.target.excerpt)}` : ""}`
    : "";
  return `/notes?path=${encodeURIComponent(c.target.path)}${heading}${from}`;
}
