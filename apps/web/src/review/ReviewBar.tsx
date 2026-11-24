import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { changeUrl, setReviewUi, useIncompleteRuns, useOpenChanges, useReviewActions, useReviewUi } from "./review";

/** Persistent bar for moving between changes on different pages (PRD-061, PRD-062). */
export function ReviewBar() {
  const changes = useOpenChanges();
  const { feedbackFor, message, confirm } = useReviewUi();
  const { decide, feedback, runAction } = useReviewActions();
  // Focus the confirmation once its button is enabled (the refused request has settled).
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirm && !decide.isPending) confirmButton.current?.focus(); }, [confirm, decide.isPending]);
  const incomplete = useIncompleteRuns();
  const location = useLocation();
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const feedbackInput = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => { if (feedbackFor) feedbackInput.current?.focus(); }, [feedbackFor]);
  // Publish the bar height so pages reserve space beneath their content for it.
  useEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!el) { root.style.setProperty("--review-bar-h", "0px"); return; }
    const update = () => root.style.setProperty("--review-bar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.setProperty("--review-bar-h", "0px"); };
  });

  if (changes.length === 0 && !feedbackFor && !message && !confirm && incomplete.length === 0) return null;
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
    <section className="review-bar" role="region" aria-label="Changes awaiting review" ref={barRef}>
      {current ? (
        <div className="review-main">
          <p className="review-source">{current.sourceLabel}</p>
          <p className="review-status">
            <strong>Change {index + 1} of {changes.length}</strong>
            <span className="review-summary"> · {current.summary}</span>
            {current.state === "prepared" ? <span className="conflict-tag"> · Not written: {current.fileError ?? "the write did not happen"}</span> : null}
            {current.state === "conflicted" ? <span className="conflict-tag"> · Conflict: {current.conflictReason === "ambiguous" ? "the text appears more than once" : current.file === ".nexus/issues.json" ? "the issue was edited after the change" : "the text was edited after the change"}</span> : null}
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
      {confirm ? (
        <div className="confirm-related" role="group" aria-label={confirm.action === "accept" ? "Accept related changes" : "Reject related changes"}>
          <p>
            {/* Summaries carry their own quotation marks, so they are not quoted again here. */}
            <strong>{confirm.action === "accept" ? "Accepting:" : "Rejecting:"}</strong> {confirm.change.summary}
          </p>
          <p>
            {confirm.action === "accept"
              ? <>It needs {confirm.others.length === 1 ? "another change that is" : `${confirm.others.length} other changes that are`} still awaiting review. Accept them together?</>
              : <>This also rejects and undoes {confirm.others.length === 1 ? "the change that depends on it" : `the ${confirm.others.length} changes that depend on it`}. Your newer edits are kept.</>}
          </p>
          <ul className="plain">{confirm.others.map((o) => <li key={o.changeId}>{o.summary}</li>)}</ul>
          <div className="review-actions">
            <button type="button" className="primary" ref={confirmButton} disabled={decide.isPending}
              onClick={() => decide.mutate({ change: confirm.change, action: confirm.action, together: true })}>
              {confirm.action === "accept" ? (confirm.others.length === 1 ? "Accept both" : `Accept all ${confirm.others.length + 1}`) : (confirm.others.length === 1 ? "Reject both" : `Reject all ${confirm.others.length + 1}`)}
            </button>
            <button type="button" onClick={() => setReviewUi({ confirm: null })}>Cancel</button>
          </div>
        </div>
      ) : null}
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
