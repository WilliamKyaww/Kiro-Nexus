// Accepted and proposed due dates (architecture 7.7): while a due-date change awaits review,
// the tentative value is on disk, and the accepted value is the change's `before`.
import type { ChangeView, Due, Issue } from "@nexus/schema";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface DueView {
  accepted: Due;
  /** The value awaiting review, when a due-date change is open on this issue. */
  proposed: Due | null;
  changeId: string | null;
}

export function dueView(issue: Issue, changes: ChangeView[]): DueView {
  const open = changes.find((c) => c.kind === "record.updateField" && c.field === "due" && c.recordKey === issue.key
    && (c.state === "pending" || c.state === "conflicted") && same(issue.due, c.after));
  if (!open) return { accepted: issue.due, proposed: null, changeId: null };
  return { accepted: (open.before ?? null) as Due, proposed: issue.due, changeId: open.changeId };
}

/** Whether any change awaiting review targets this issue. */
export const hasPendingChange = (issue: Issue, changes: ChangeView[]) =>
  changes.some((c) => c.recordKey === issue.key && (c.state === "pending" || c.state === "conflicted"));
