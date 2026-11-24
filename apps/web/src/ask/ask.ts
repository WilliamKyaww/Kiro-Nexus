// Ask state shared by Home and the conversation page.
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export interface Citation {
  handle: string;
  label: string;
  target: { kind: "note"; path: string; headingSlug: string | null; headingText: string | null } | { kind: "issue"; key: string };
}
export interface AnswerItem { text: string; sources: string[]; unsupported?: boolean; qualifier?: string }
export interface StoredAnswer {
  facts: AnswerItem[]; discrepancies: AnswerItem[]; suggestions: AnswerItem[]; unconfirmed?: AnswerItem[];
  insufficientEvidence: boolean; insufficientReason: string | null;
  citations: Record<string, Citation>; removedCitations: number; demoted: number;
}
export interface Message {
  id: string; role: "user" | "assistant"; at: string; runId: string | null; text: string | null;
  status: "complete" | "running" | "failed" | "cancelled";
  answer: StoredAnswer | null;
  meta: null | { profileName: string; model: string; receivingHost: string; mode: string; fixture: boolean; scopeNote: string; steps: number; rejectedToolCalls: string[]; plainReplyIgnored: boolean };
  error: null | { code: string; message: string };
}
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[]; activeRun: string | null }
export interface AskStatus {
  available: boolean; reason: string | null; message: string | null;
  profile: null | { id: string; name: string; model: string; receivingHost: string; fixture: boolean };
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

/** Ask a question in an existing conversation, or a new one. Resolves to the conversation ID. */
export function useAsk() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ question, conversationId }: { question: string; conversationId?: string }) => {
      const id = conversationId ?? (await api.post<{ id: string }>("/conversations", {})).id;
      await api.post(`/conversations/${encodeURIComponent(id)}/ask`, { question });
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

export function citationHref(c: Citation, conversationId: string): string {
  const from = `&from=${encodeURIComponent(`/c/${conversationId}`)}`;
  if (c.target.kind === "issue") return `/issues/${encodeURIComponent(c.target.key)}?from=${encodeURIComponent(`/c/${conversationId}`)}`;
  return `/notes?path=${encodeURIComponent(c.target.path)}${c.target.headingSlug ? `&heading=${encodeURIComponent(c.target.headingSlug)}` : ""}${from}`;
}
