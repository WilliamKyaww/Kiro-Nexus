import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { changeUrl, setReviewUi, useIncompleteRuns, useOpenChanges, useReviewActions, useReviewUi } from "./review";

/** Persistent bar for moving between changes on different pages (PRD-061, PRD-062). */
export function ReviewBar() {
  const changes = useOpenChanges();
  const { feedbackFor, message } = useReviewUi();
  const { decide, feedback, runAction } = useReviewActions();
  const incomplete = useIncompleteRuns();
  const location = useLocation();
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const feedbackInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (feedbackFor) feedbackInput.current?.focus(); }, [feedbackFor]);

  if (changes.length === 0 && !feedbackFor && !message && incomplete.length === 0) return null;
  const focused = new URLSearchParams(location.search).get("change");
  const found = changes.findIndex((c) => c.changeId === focused);
  const index = found >= 0 ? found : 0;
  const current = changes[index];
  const go = (delta: number) => { const next = changes[(index + delta + changes.length) % changes.length]; if (next) navigate(changeUrl(next)); };
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (feedbackFor && reason.trim()) feedback.mutate({ change: feedbackFor, text: reason.trim() });
    setReason("");
  };

  return (
    <section className="review-bar" role="region" aria-label="Changes awaiting review">
      {current ? (
        <div className="review-main">
          <p className="review-source">{current.sourceLabel}</p>
          <p className="review-status">
            <strong>Change {index + 1} of {changes.length}</strong>
            <span> · {current.summary}</span>
            {current.state === "prepared" ? <span className="conflict-tag"> · Not written: {current.fileError ?? "the write did not happen"}</span> : null}
            {current.state === "conflicted" ? <span className="conflict-tag"> · Conflict: {current.conflictReason === "ambiguous" ? "the text appears more than once" : "the text was edited after the change"}</span> : null}
          </p>
          <div className="review-actions">
            <button type="button" onClick={() => go(-1)} disabled={changes.length < 2}>Previous</button>
            <button type="button" onClick={() => go(1)} disabled={changes.length < 2}>Next</button>
            {found < 0 ? <button type="button" onClick={() => navigate(changeUrl(current))}>Show</button> : null}
            {current.state === "pending" ? (
              <>
                <button type="button" className="primary" disabled={decide.isPending} onClick={() => decide.mutate({ change: current, action: "accept" })}>Accept</button>
                <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ change: current, action: "reject" })}>Reject</button>
              </>
            ) : null}
            {current.state === "conflicted" ? (
              <button type="button" className="primary" disabled={decide.isPending} onClick={() => decide.mutate({ change: current, action: "keep-current" })}>Keep current version</button>
            ) : null}
          </div>
        </div>
      ) : <p className="review-status"><strong>All changes reviewed.</strong></p>}
      {incomplete.map((run) => (
        <div key={run.runId} className="incomplete-run" role="group" aria-label="Changes that were not written">
          <p>
            <strong>Not written:</strong>{" "}
            {run.files.filter((f) => f.state === "failed").map((f) => `${f.path === ".nexus/issues.json" ? "issue data" : f.path} (${f.error ?? "unknown error"})`).join("; ")}.
            {" "}Files already written stay reviewable.
          </p>
          <div className="review-actions">
            <button type="button" className="primary" disabled={runAction.isPending} onClick={() => runAction.mutate({ runId: run.runId!, action: "retry" })}>Retry writing</button>
            <button type="button" disabled={runAction.isPending} onClick={() => runAction.mutate({ runId: run.runId!, action: "discard" })}>Discard unwritten changes</button>
          </div>
        </div>
      ))}
      <p className="review-message" role="status" aria-live="polite">{message ?? ""}</p>
      {feedbackFor ? (
        <form className="feedback" onSubmit={send} aria-label="Feedback on the rejected change">
          <label htmlFor="review-reason">What was wrong, or what should be kept? (optional)</label>
          <textarea id="review-reason" ref={feedbackInput} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="review-actions">
            <button type="submit" disabled={!reason.trim() || feedback.isPending}>Send reason</button>
            <button type="button" onClick={() => setReviewUi({ feedbackFor: null })}>Skip</button>
          </div>
        </form>
      ) : null}
      {!current && !feedbackFor ? <button type="button" className="link-button" onClick={() => setReviewUi({ message: null })}>Dismiss</button> : null}
    </section>
  );
}
