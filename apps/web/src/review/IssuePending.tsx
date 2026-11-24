import type { IssueView } from "@nexus/schema";
import { describeValue, useOpenChanges, useReviewActions } from "./review";

const fieldLabel: Record<string, string> = { due: "Due date", status: "Status", priority: "Priority", title: "Title", description: "Description" };

/** Pending changes for this issue, shown above its fields with their own Accept and Reject. */
export function IssuePending({ issue }: { issue: IssueView }) {
  const changes = useOpenChanges().filter((c) => c.recordKey === issue.key);
  const { decide } = useReviewActions();
  if (changes.length === 0) return null;
  return (
    <div className="pending-list" aria-label="Changes awaiting review on this issue">
      {changes.map((c) => (
        <div key={c.changeId} className={`pending-change pending-field-note${c.state === "conflicted" ? " conflicted" : ""}`} data-change-id={c.changeId}>
          <p>
            <span className="pending-badge">{c.state === "conflicted" ? "Conflict" : c.state === "prepared" ? "Not written" : "Pending review"}</span>{" "}
            <strong>{fieldLabel[c.field ?? ""] ?? c.field}</strong>: {describeValue(c.field, c.before)} → <strong>{describeValue(c.field, c.after)}</strong>
            <span className="muted"> ({c.sourceLabel})</span>
          </p>
          {c.state === "prepared" ? <p className="muted">This change was never written, so the issue still shows its current value. Use Retry or Discard in the review bar.</p> : null}
          {c.state === "pending" ? (
            <div className="row">
              <button type="button" className="primary" disabled={decide.isPending} onClick={() => decide.mutate({ change: c, action: "accept" })}
                aria-label={`Accept ${fieldLabel[c.field ?? ""] ?? c.field} change`}>Accept</button>
              <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ change: c, action: "reject" })}
                aria-label={`Reject ${fieldLabel[c.field ?? ""] ?? c.field} change`}>Reject</button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function pendingFieldIds(issueKey: string, changes: ReturnType<typeof useOpenChanges>): Map<string, string> {
  return new Map(changes.filter((c) => c.recordKey === issueKey && c.field).map((c) => [c.field!, c.changeId]));
}
