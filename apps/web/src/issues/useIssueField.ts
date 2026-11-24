// One mutation for single-field edits from the board and the calendar. It uses the same
// field merge as the issue page (DEC-015): an edit to one field never overwrites someone
// else's newer edit to another, and a clash on the same field is reported, not overwritten.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Issue, IssuePatch, IssueView } from "@nexus/schema";
import { ApiError, api } from "../api";

export function useIssueField() {
  const client = useQueryClient();
  return useMutation({
    // `base` is the issue as the user saw it when the edit began (R4-5). Without one, the edit
    // is based on the issue as passed, which is right for a single action such as a drag.
    mutationFn: ({ issue, patch, base }: { issue: Issue; patch: IssuePatch; base?: { revision: number; values: IssuePatch } }) => {
      const baseValues = base?.values ?? Object.fromEntries(Object.keys(patch).map((f) => [f, issue[f as keyof IssuePatch]])) as IssuePatch;
      return api.patch<IssueView>(`/issues/${encodeURIComponent(issue.key)}`, { baseRevision: base?.revision ?? issue.revision, patch, baseValues });
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["issues"] }),
        client.invalidateQueries({ queryKey: ["issue"] }),
        client.invalidateQueries({ queryKey: ["review"] }),
      ]);
    },
  });
}

/** A plain message for a failed field edit. */
export function fieldErrorMessage(error: unknown, key: string): string {
  if (error instanceof ApiError && error.code === "REVISION_MISMATCH") {
    return `Someone else changed ${key} in the same field since this view loaded, so nothing was saved. The view now shows the latest version.`;
  }
  return error instanceof Error ? error.message : "The change could not be saved.";
}
