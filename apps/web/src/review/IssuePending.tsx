import type { ChangeView, IssueView, NoteLink } from "@nexus/schema";
import { describeValue, useOpenChanges, useReviewActions } from "./review";

const fieldLabel: Record<string, string> = { due: "Due date", status: "Status", priority: "Priority", title: "Title", description: "Description" };

export const linkLabel = (l: Pick<NoteLink, "notePath" | "headingText">) => `${l.notePath.replace(/\.md$/i, "")}${l.headingText ? ` › ${l.headingText}` : ""}`;

/** What the change is, in the words used on its Accept and Reject buttons. */
function subject(c: ChangeView): string {
  if (c.kind === "record.create") return "new issue";
  if (c.kind === "record.addLink") return "new link";
  return `${fieldLabel[c.field ?? ""] ?? c.field} change`;
}

function Description({ c }: { c: ChangeView }) {
  if (c.kind === "record.create") return <><strong>New issue</strong>: this whole issue was proposed and is not yet part of the project</>;
  if (c.kind === "record.addLink") return <><strong>New link</strong> to {linkLabel(c.after as NoteLink)}</>;
  return <><strong>{fieldLabel[c.field ?? ""] ?? c.field}</strong>: {describeValue(c.field, c.before)} → <strong>{describeValue(c.field, c.after)}</strong></>;
}

/** Pending changes for this issue, shown above its fields with their own Accept and Reject. */
export function IssuePending({ issue }: { issue: IssueView }) {
  const changes = useOpenChanges().filter((c) => c.recordKey === issue.key);
  const { decide } = useReviewActions();
  if (changes.length === 0) return null;
  return (
    <div className="pending-list" aria-label="Changes awaiting review on this issue">
      {changes.map((c) => (
        <div key={c.changeId} className={`pending-change pending-field-note${c.state === "conflicted" ? " conflicted" : ""}`} data-change-id={c.changeId} tabIndex={-1}>
          <p>
            <span className="pending-badge">{c.state === "conflicted" ? "Conflict" : c.state === "prepared" ? "Not written" : "Pending review"}</span>{" "}
            <Description c={c} />
            <span className="muted"> ({c.sourceLabel})</span>
          </p>
          {c.state === "prepared" ? <p className="muted">This change was never written, so the issue still shows its current value. Use Retry or Discard in the review bar.</p> : null}
          {c.dependents.length && c.kind === "record.create" ? <p className="muted">Other proposed changes refer to this issue. Rejecting it rejects them too, after you confirm.</p> : null}
          {c.state === "pending" ? (
            <div className="row">
              <button type="button" className="primary" disabled={decide.isPending} onClick={() => decide.mutate({ change: c, action: "accept" })}
                aria-label={`Accept ${subject(c)}`}>Accept</button>
              <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ change: c, action: "reject" })}
                aria-label={`Reject ${subject(c)}`}>Reject</button>
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
