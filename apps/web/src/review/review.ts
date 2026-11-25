// Review state shared by the bar, the note and issue pages, and Home.
import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ChangeView, RunOutcome } from "@nexus/schema";
import { ApiError, api, notePathParam } from "../api";

export const openChangesKey = ["review", "open"] as const;

export function useOpenChanges(): ChangeView[] {
  const q = useQuery({ queryKey: openChangesKey, queryFn: () => api.get<{ changes: ChangeView[] }>("/review/changes?state=open") });
  return q.data?.changes ?? [];
}

/** Rejected changes whose correction is running, failed or proposed nothing (PRD-064). */
export function useCorrections(): ChangeView[] {
  const q = useQuery({ queryKey: ["review", "corrections"], queryFn: () => api.get<{ changes: ChangeView[] }>("/review/changes?state=corrections") });
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

export function changeUrl(c: Pick<ChangeView, "kind" | "file" | "recordKey" | "changeId">): string {
  return c.kind === "note.replaceSpan"
    ? `${notePathParam(c.file)}&change=${encodeURIComponent(c.changeId)}`
    : `/issues/${encodeURIComponent(c.recordKey ?? "")}?change=${encodeURIComponent(c.changeId)}`;
}

/**
 * Related changes that must be decided together (architecture 7.4), awaiting the user's
 * confirmation. For "discard", the run's unwritten changes are dropped and `others` (written
 * changes that need them) are rejected and undone first (R4-3).
 */
export type DecisionConfirm =
  | { action: "accept" | "reject"; change: ChangeView; others: Array<{ changeId: string; summary: string }> }
  | { action: "discard"; runId: string; others: Array<{ changeId: string; summary: string }> };

// --- Tiny store: which rejected change is waiting for optional feedback, the last message, and
// a decision waiting for confirmation because related changes would be decided with it. ---
// `correctionFor`: the rejected change whose correction this tab started; its corrected change
// opens on its target once, when it appears.
interface ReviewUiState { feedbackFor: ChangeView | null; message: string | null; confirm: DecisionConfirm | null; correctionFor: string | null }
let uiState: ReviewUiState = { feedbackFor: null, message: null, confirm: null, correctionFor: null };
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
  const goNext = async (after: ChangeView, action: string) => {
    const remaining = (client.getQueryData<{ changes: ChangeView[] }>(openChangesKey)?.changes ?? []).filter((c) => c.changeId !== after.changeId);
    const next = remaining.find((c) => c.state === "pending") ?? remaining[0];
    if (next) navigate(changeUrl(next));
    // A rejected new issue no longer exists, so leave its page for the project's board.
    else if (action === "reject" && after.kind === "record.create" && after.recordKey) navigate(`/projects/${encodeURIComponent(after.recordKey.split("-")[0]!)}`);
  };
  /** After the reason is sent or skipped: on to the next change awaiting review, if any. */
  const moveOn = () => {
    const open = client.getQueryData<{ changes: ChangeView[] }>(openChangesKey)?.changes ?? [];
    const next = open.find((c) => c.state === "pending") ?? open[0];
    if (next) navigate(changeUrl(next));
  };
  const decide = useMutation({
    // `together` confirms that related changes are decided with this one: the changes it needs
    // when accepting, or the changes that need it when rejecting.
    mutationFn: ({ change, action, together = false }: { change: ChangeView; action: "accept" | "reject" | "keep-current"; together?: boolean }) => {
      const flag = together ? (action === "accept" ? "?withDependencies=1" : action === "reject" ? "?withDependents=1" : "") : "";
      return api.post<ChangeView>(`/review/changes/${encodeURIComponent(change.changeId)}/${action}${flag}`);
    },
    onSuccess: async (result, { change, action, together }) => {
      const others = together && uiState.confirm?.action !== "discard" ? uiState.confirm?.others ?? [] : [];
      const also = others.length ? `, with ${others.length === 1 ? "the change it is tied to" : `${others.length} related changes`}` : "";
      if (action === "accept") setReviewUi({ message: `Accepted: ${change.summary}${also}`, feedbackFor: null, confirm: null });
      if (action === "keep-current") setReviewUi({ message: `Kept the current version: ${change.summary}`, feedbackFor: null, confirm: null });
      if (action === "reject" && result.state === "rejected") setReviewUi({ message: `Rejected and undone: ${change.summary}${also}`, feedbackFor: result, confirm: null });
      if (action === "reject" && result.state === "conflicted") {
        setReviewUi({ message: result.conflictReason === "ambiguous"
          ? "Nexus could not tell which copy of this text to undo, so it changed nothing. Keep the current version, or edit it by hand."
          : result.conflictReason === "changed" && result.kind === "record.create"
            ? "This issue was edited after it was proposed, so Nexus kept it and changed nothing. Keep the current version, or delete it by hand."
            : "This text was edited after the change, so Nexus kept the newer version and changed nothing.", feedbackFor: null, confirm: null });
      }
      await refresh();
      // A rejection asks why. Stay on its target until the reason is sent or skipped, so the
      // next change's page does not take focus from the question, and a correction lands here.
      // A rejected new issue no longer has a page, so its board opens instead.
      const asksWhy = action === "reject" && result.state === "rejected";
      if (asksWhy && change.kind === "record.create" && change.recordKey) navigate(`/projects/${encodeURIComponent(change.recordKey.split("-")[0]!)}`);
      else if (result.state !== "conflicted" && !asksWhy) await goNext(change, action);
    },
    onError: (e, { change, action }) => {
      const details = e instanceof ApiError ? (e.details as { reason?: string; changes?: Array<{ changeId: string; summary: string }> } | undefined) : undefined;
      if (e instanceof ApiError && e.code === "CONFLICT" && (action === "accept" || action === "reject")
        && (details?.reason === "needs-dependencies" || details?.reason === "has-dependents") && details.changes?.length) {
        setReviewUi({ confirm: { change, action, others: details.changes }, message: null });
        return;
      }
      setReviewUi({ message: (e as Error).message, confirm: null });
    },
  });
  // A reason is saved first. For an Edit change to a field or note lines it also starts a
  // correction run, whose change opens here when it is proposed (PRD-064).
  const feedback = useMutation({
    mutationFn: ({ change, text }: { change: ChangeView; text: string }) => api.post<ChangeView>(`/review/changes/${encodeURIComponent(change.changeId)}/feedback`, { text }),
    onSuccess: async (result) => {
      const c = result.correction;
      if (c?.state === "running" || c?.state === "queued") setReviewUi({ feedbackFor: null, correctionFor: result.changeId, message: "Your reason is saved. Nexus is preparing a corrected change from it." });
      else if (c?.state === "proposed") setReviewUi({ feedbackFor: null, message: "A corrected change was already proposed for this one." });
      else if (c?.state === "failed") setReviewUi({ feedbackFor: null, message: `Your reason is saved, but the correction did not start: ${c.message ?? "unknown error"}` });
      else if (result.sourceKind === "agent" && !result.correctable) setReviewUi({ feedbackFor: null, message: "Your reason is saved with the rejected change. Nexus corrects changes to an issue field or to note lines; for a new issue or link, ask again in Edit." });
      else setReviewUi({ feedbackFor: null, message: "Thanks. Your reason is saved with the rejected change." });
      await refresh();
      // A correction opens here when it is proposed; otherwise move on to the next change.
      if (c?.state !== "running" && c?.state !== "queued") moveOn();
    },
    onError: (e) => setReviewUi({ message: (e as Error).message }),
  });
  // Retry a correction from the saved reason, or keep the change rejected.
  // Used by the review bar and by a failed correction turn in its conversation, which must retry
  // the same bound correction rather than send an ordinary Edit (R6-5).
  const correction = useMutation({
    mutationFn: ({ changeId, action }: { changeId: string; action: "retry" | "drop" }) =>
      api.post<ChangeView>(`/review/changes/${encodeURIComponent(changeId)}/correction${action === "drop" ? "/drop" : ""}`),
    onSuccess: async (result, { action }) => {
      if (action === "drop") setReviewUi({ message: `Kept rejected: ${result.summary}`, correctionFor: null });
      else if (result.correction?.state === "running" || result.correction?.state === "queued") setReviewUi({ correctionFor: result.changeId, message: "Nexus is preparing a corrected change from your reason." });
      else if (result.correction?.state === "proposed") setReviewUi({ message: "A corrected change was already proposed for this one." });
      else setReviewUi({ message: result.correction?.message ?? "The correction did not start." });
      await refresh();
      await client.invalidateQueries({ queryKey: ["conversation"] });
    },
    onError: (e) => setReviewUi({ message: (e as Error).message }),
  });
  const runAction = useMutation({
    mutationFn: ({ runId, action, together = false }: { runId: string; action: "retry" | "discard"; together?: boolean }) =>
      api.post<RunOutcome>(`/review/runs/${encodeURIComponent(runId)}/${action}${together && action === "discard" ? "?withDependents=1" : ""}`),
    onSuccess: async (o, { action, together }) => {
      const failed = o.files.filter((f) => f.state === "failed");
      const conflicted = o.files.filter((f) => f.state === "conflicted");
      const undone = together ? uiState.confirm?.others.length ?? 0 : 0;
      setReviewUi({
        feedbackFor: null,
        confirm: null,
        message: action === "discard"
          ? undone
            ? `Discarded the changes that were never written, and rejected and undid ${undone === 1 ? "the change that needed them" : `the ${undone} changes that needed them`}.`
            : "Discarded the changes that were never written. The files were not touched."
          : failed.length
            ? `Retry failed again: ${failed.map((f) => f.error ?? f.path).join("; ")}`
            : conflicted.length
              ? "Retry found newer edits to the same text or field, so it changed nothing there. Review the conflict."
              : "Retry wrote the outstanding changes. Review them now.",
      });
      await refresh();
    },
    onError: (e, { runId, action }) => {
      const details = e instanceof ApiError ? (e.details as { reason?: string; changes?: Array<{ changeId: string; summary: string }> } | undefined) : undefined;
      if (action === "discard" && e instanceof ApiError && e.code === "CONFLICT" && details?.reason === "has-dependents" && details.changes?.length) {
        setReviewUi({ confirm: { action: "discard", runId, others: details.changes }, message: null });
        return;
      }
      setReviewUi({ message: (e as Error).message, confirm: null });
    },
  });
  return { decide, feedback, runAction, correction, moveOn };
}
