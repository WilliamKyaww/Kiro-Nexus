// One mutation for single-field edits from the board and the calendar. It uses the same
// field merge as the issue page (DEC-015): an edit to one field never overwrites someone
// else's newer edit to another, and a clash on the same field is reported, not overwritten.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Issue, IssuePatch, IssueView } from "@nexus/schema";
import { ApiError, api } from "../api";

export function useIssueField() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ issue, patch }: { issue: Issue; patch: IssuePatch }) => {
      const baseValues = Object.fromEntries(Object.keys(patch).map((f) => [f, issue[f as keyof IssuePatch]])) as IssuePatch;
      return api.patch<IssueView>(`/issues/${encodeURIComponent(issue.key)}`, { baseRevision: issue.revision, patch, baseValues });
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
