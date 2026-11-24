import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ChangeView } from "@nexus/schema";
import { api } from "../api";
import { changeUrl } from "../review/review";
import type { EditChange, Message } from "./ask";

const STATE_TEXT: Record<string, string> = {
  prepared: "Not written", pending: "Awaiting your review", rejecting: "Being undone", conflicted: "Conflict: needs your decision",
  accepted: "Accepted", rejected: "Rejected and undone", superseded: "Replaced by a correction",
};
const OPEN = new Set(["prepared", "pending", "rejecting", "conflicted"]);

export const allChangesKey = ["review", "all"] as const;

/** The changes an Edit turn proposed, with their current review state and a link to each. */
export function EditCard({ message, conversationId }: { message: Message; conversationId: string }) {
  const edit = message.edit ?? null;
  const all = useQuery({
    queryKey: allChangesKey, enabled: !!edit?.changes.length,
    queryFn: () => api.get<{ changes: ChangeView[] }>("/review/changes?state=all"),
  });
  if (!edit) {
    return message.authority === "edit" && message.status === "complete"
      ? <p className="notice" role="note">Nexus proposed no changes for this request, so nothing was written.</p>
      : null;
  }
  const live = new Map((all.data?.changes ?? []).map((c) => [c.changeId, c]));
  const summaryOf = new Map(edit.changes.map((c) => [c.changeId, c.summary]));
  const from = `&from=${encodeURIComponent(`/c/${conversationId}`)}`;
  const label = live.get(edit.changes[0]?.changeId ?? "")?.sourceLabel;
  const row = (c: EditChange) => {
    const v = live.get(c.changeId);
    const state = v?.state ?? c.state;
    return (
      <li key={c.changeId} data-testid={`proposed-change-${c.kind}`}>
        {OPEN.has(state) ? <Link to={`${changeUrl(v ?? c)}${from}`}>{c.summary}</Link> : <span>{c.summary}</span>}
        {" "}<span className={`state-tag state-${state}`}>{STATE_TEXT[state] ?? state}</span>
        {c.dependsOn.length ? <span className="muted"> · needs {c.dependsOn.map((d) => summaryOf.get(d) ?? "another change").join(", ")}</span> : null}
      </li>
    );
  };
  return (
    <section className="edit-card" aria-label="Proposed changes">
      <h3>Proposed changes</h3>
      <p className="muted">
        Nexus wrote these to your files for review. Each one stays only if you accept it; rejecting one undoes it.
        {label ? ` Source: ${label}.` : ""}
      </p>
      <ol>{edit.changes.map(row)}</ol>
      {edit.failedFiles.length ? (
        <p className="error" role="alert">Not written: {edit.failedFiles.map((f) => `${f.path === ".nexus/issues.json" ? "issue data" : f.path} (${f.error ?? "unknown error"})`).join("; ")}. Use Retry or Discard in the review bar.</p>
      ) : null}
    </section>
  );
}
