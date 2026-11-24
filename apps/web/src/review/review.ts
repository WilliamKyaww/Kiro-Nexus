// Review state shared by the bar, the note and issue pages, and Home.
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ChangeView, RunOutcome } from "@nexus/schema";
import { api, notePathParam } from "../api";

export const openChangesKey = ["review", "open"] as const;

export function useOpenChanges(): ChangeView[] {
  const q = useQuery({ queryKey: openChangesKey, queryFn: () => api.get<{ changes: ChangeView[] }>("/review/changes?state=open") });
  return q.data?.changes ?? [];
}

export const incompleteRunsKey = ["review", "incomplete"] as const;

export function useIncompleteRuns(): RunOutcome[] {
  const q = useQuery({ queryKey: incompleteRunsKey, queryFn: () => api.get<{ runs: RunOutcome[] }>("/review/runs/incomplete") });
  return q.data?.runs ?? [];
}

const fileLabel = (path: string) => (path === ".nexus/issues.json" ? "the issue data" : path);

/** Plain-language summary of what a run actually wrote, file by file. */
export function describeOutcome(o: RunOutcome): string {
  const written = o.files.filter((f) => f.state === "written").length;
  const failed = o.files.filter((f) => f.state === "failed");
  if (o.repeated && failed.length === 0) return "These demo changes were already applied in this workspace.";
  if (failed.length === 0) return `Applied ${o.changes.length} demo change${o.changes.length === 1 ? "" : "s"} to the real files. Review each one.`;
  const lead = o.repeated ? "These demo changes were proposed before, but not all of them were written. " : "";
  return `${lead}${written} of ${o.files.length} files were written. Not written: ${failed.map((f) => fileLabel(f.path)).join(", ")}. Use Retry or Discard in the review bar.`;
}

export function changeUrl(c: ChangeView): string {
  return c.kind === "note.replaceSpan"
    ? `${notePathParam(c.file)}&change=${encodeURIComponent(c.changeId)}`
    : `/issues/${encodeURIComponent(c.recordKey ?? "")}?change=${encodeURIComponent(c.changeId)}`;
}

// --- Tiny store: which rejected change is waiting for optional feedback, and the last message. ---
interface ReviewUiState { feedbackFor: ChangeView | null; message: string | null }
let uiState: ReviewUiState = { feedbackFor: null, message: null };
const listeners = new Set<() => void>();
export function setReviewUi(patch: Partial<ReviewUiState>): void {
  uiState = { ...uiState, ...patch };
  for (const l of listeners) l();
}
export function useReviewUi(): ReviewUiState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => uiState);
}

export function describeValue(field: string | null, value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (field === "due" && typeof value === "object" && value && "date" in value) {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${(value as { date: string }).date}T00:00:00Z`));
  }
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
}

/** Accept / reject / keep-current, then move to the next open change. */
export function useReviewActions() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ["review"] }),
    client.invalidateQueries({ queryKey: ["note"] }),
    client.invalidateQueries({ queryKey: ["issue"] }),
    client.invalidateQueries({ queryKey: ["issues"] }),
  ]);
  const goNext = async (afterId: string) => {
    const remaining = (client.getQueryData<{ changes: ChangeView[] }>(openChangesKey)?.changes ?? []).filter((c) => c.changeId !== afterId);
    const next = remaining.find((c) => c.state === "pending") ?? remaining[0];
    if (next) navigate(changeUrl(next));
  };
  const decide = useMutation({
    mutationFn: ({ change, action }: { change: ChangeView; action: "accept" | "reject" | "keep-current" }) =>
      api.post<ChangeView>(`/review/changes/${encodeURIComponent(change.changeId)}/${action}`),
    onSuccess: async (result, { change, action }) => {
      if (action === "accept") setReviewUi({ message: `Accepted: ${change.summary}`, feedbackFor: null });
      if (action === "keep-current") setReviewUi({ message: `Kept the current version: ${change.summary}`, feedbackFor: null });
      if (action === "reject" && result.state === "rejected") setReviewUi({ message: `Rejected and undone: ${change.summary}`, feedbackFor: result });
      if (action === "reject" && result.state === "conflicted") {
        setReviewUi({ message: result.conflictReason === "ambiguous"
          ? "Nexus could not tell which copy of this text to undo, so it changed nothing. Keep the current version, or edit it by hand."
          : "This text was edited after the change, so Nexus kept the newer version and changed nothing.", feedbackFor: null });
      }
      await refresh();
      if (result.state !== "conflicted") await goNext(change.changeId);
    },
    onError: (e) => setReviewUi({ message: (e as Error).message }),
  });
  const feedback = useMutation({
    mutationFn: ({ change, text }: { change: ChangeView; text: string }) => api.post<ChangeView>(`/review/changes/${encodeURIComponent(change.changeId)}/feedback`, { text }),
    onSuccess: () => setReviewUi({ feedbackFor: null, message: "Thanks. Your reason is saved with the rejected change. AI corrections arrive in slice D." }),
  });
  const runAction = useMutation({
    mutationFn: ({ runId, action }: { runId: string; action: "retry" | "discard" }) => api.post<RunOutcome>(`/review/runs/${encodeURIComponent(runId)}/${action}`),
    onSuccess: async (o, { action }) => {
      const failed = o.files.filter((f) => f.state === "failed");
      const conflicted = o.files.filter((f) => f.state === "conflicted");
      setReviewUi({
        feedbackFor: null,
        message: action === "discard"
          ? "Discarded the changes that were never written. The files were not touched."
          : failed.length
            ? `Retry failed again: ${failed.map((f) => f.error ?? f.path).join("; ")}`
            : conflicted.length
              ? "Retry found newer edits to the same text or field, so it changed nothing there. Review the conflict."
              : "Retry wrote the outstanding changes. Review them now.",
      });
      await refresh();
    },
    onError: (e) => setReviewUi({ message: (e as Error).message }),
  });
  return { decide, feedback, runAction };
}
