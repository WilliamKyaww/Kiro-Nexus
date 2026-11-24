// Project board (PRD-030, PRD-031): To do · In progress · Done, with the backlog kept as a
// second view. Status moves by drag (mouse) and by keyboard (Alt+Arrow keys or the status
// control). Placeholder styling: Hein owns the final design.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ChangeView, Issue, IssueStatus, IssueView, Project } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { formatDue, priorityLabel, statusLabel } from "../format";
import { DueDateEditor } from "../issues/DueDateEditor";
import { dueView, hasPendingChange } from "../issues/proposed";
import { fieldErrorMessage, useIssueField } from "../issues/useIssueField";
import { useOpenChanges } from "../review/review";

const STATUSES: IssueStatus[] = ["todo", "in_progress", "done"];

export function BoardPage() {
  const { key = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "backlog" ? "backlog" : "board";
  const client = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: Project[] }>("/projects") });
  const project = projects.data?.projects.find((p) => p.key === key);
  const issues = useQuery({
    queryKey: ["issues", project?.id],
    enabled: !!project,
    queryFn: () => api.get<{ issues: Issue[] }>(`/issues?projectId=${encodeURIComponent(project!.id)}`),
  });
  const changes = useOpenChanges();
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<IssueView>("/issues", { projectId: project!.id, title: title.trim() }),
    onSuccess: (issue) => { void client.invalidateQueries({ queryKey: ["issues"] }); navigate(`/issues/${issue.key}`); },
  });
  if (projects.isSuccess && !project) return <section className="page"><h1>Project not found</h1><Link to="/projects">All projects</Link></section>;
  const list = [...(issues.data?.issues ?? [])].sort((a, b) => a.rank.localeCompare(b.rank));
  return (
    <section className="page board-page" aria-labelledby="project-h">
      <p className="path"><Link to="/projects">Projects</Link> / {key}</p>
      <h1 id="project-h">{project ? `${project.key} ${project.name}` : key}</h1>
      <div className="segmented" role="group" aria-label="View">
        <button type="button" aria-pressed={view === "board"} onClick={() => setParams({})}>Board</button>
        <button type="button" aria-pressed={view === "backlog"} onClick={() => setParams({ view: "backlog" })}>Backlog</button>
      </div>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} aria-label="Create an issue">
        <label>New issue<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Write the judge instructions" required /></label>
        <button type="submit" disabled={create.isPending || !project}>Create issue</button>
        {create.error ? <ErrorNote error={create.error} /> : null}
      </form>
      {issues.isSuccess && list.length === 0 ? <p className="muted">No issues yet.</p> : null}
      {view === "board" ? <Board issues={list} changes={changes} /> : <Backlog projectKey={key} issues={list} changes={changes} />}
    </section>
  );
}

function Board({ issues, changes }: { issues: Issue[]; changes: ChangeView[] }) {
  const move = useIssueField();
  const [announce, setAnnounce] = useState("");
  const [focusTarget, setFocusTarget] = useState<{ key: string; status: IssueStatus } | null>(null);
  const [dropTarget, setDropTarget] = useState<IssueStatus | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  // Keep focus on a card that the keyboard moved, once it has re-rendered in its new column
  // (the card is a new element there, so focus would otherwise fall back to the page).
  useEffect(() => {
    if (!focusTarget) return;
    const el = cardRefs.current.get(focusTarget.key);
    if (el && el.dataset.status === focusTarget.status) { el.focus(); setFocusTarget(null); }
  }, [issues, focusTarget]);

  const moveTo = (issue: Issue, status: IssueStatus, by: "keyboard" | "drag" | "control") => {
    if (status === issue.status) return;
    if (by === "keyboard") setFocusTarget({ key: issue.key, status });
    move.mutate({ issue, patch: { status } }, {
      onSuccess: () => setAnnounce(`${issue.key} moved to ${statusLabel[status]}.`),
      onError: (e) => { setFocusTarget(null); setAnnounce(fieldErrorMessage(e, issue.key)); },
    });
  };
  const onKey = (issue: Issue) => (e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft") || e.target !== e.currentTarget) return;
    e.preventDefault();
    const i = STATUSES.indexOf(issue.status) + (e.key === "ArrowRight" ? 1 : -1);
    const next = STATUSES[i];
    if (next) moveTo(issue, next, "keyboard");
    else setAnnounce(`${issue.key} is already in ${statusLabel[issue.status]}.`);
  };
  const onDrop = (status: IssueStatus) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDropTarget(null);
    const issue = issues.find((i) => i.key === e.dataTransfer.getData("text/x-nexus-issue"));
    if (issue) moveTo(issue, status, "drag");
  };

  return (
    <>
      <p className="muted board-help">Drag a card to another column, or focus a card and press Alt+Left Arrow or Alt+Right Arrow.</p>
      <p className="board-announce" role="status" aria-live="polite">{announce}</p>
      <div className="board">
        {STATUSES.map((status) => {
          const column = issues.filter((i) => i.status === status);
          return (
            <section key={status} className={`board-column${dropTarget === status ? " drop" : ""}`} aria-labelledby={`col-${status}`}
              data-testid={`column-${status}`}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("text/x-nexus-issue")) { e.preventDefault(); setDropTarget(status); } }}
              onDragLeave={() => setDropTarget((s) => (s === status ? null : s))}
              onDrop={onDrop(status)}>
              <h2 id={`col-${status}`}>{statusLabel[status]} <span className="count">{column.length}</span></h2>
              <ul className="cards">
                {column.map((issue) => (
                  <li key={issue.id}>
                    <Card issue={issue} changes={changes} refCallback={(el) => { if (el) cardRefs.current.set(issue.key, el); else cardRefs.current.delete(issue.key); }}
                      onKeyDown={onKey(issue)} onMove={(s) => moveTo(issue, s, "control")} busy={move.isPending} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Card({ issue, changes, refCallback, onKeyDown, onMove, busy }: {
  issue: Issue; changes: ChangeView[]; refCallback: (el: HTMLElement | null) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void; onMove: (s: IssueStatus) => void; busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const due = dueView(issue, changes);
  const pending = hasPendingChange(issue, changes);
  return (
    <article ref={refCallback} className="card" tabIndex={0} draggable data-status={issue.status} data-testid={`card-${issue.key}`}
      aria-label={`${issue.key} ${issue.title}, ${statusLabel[issue.status]}`}
      onKeyDown={onKeyDown}
      onDragStart={(e) => { e.dataTransfer.setData("text/x-nexus-issue", issue.key); e.dataTransfer.effectAllowed = "move"; }}>
      <p className="card-title"><Link to={`/issues/${issue.key}`}><span className="issue-key">{issue.key}</span> {issue.title}</Link></p>
      <p className="card-meta">
        <span className={`chip priority-${issue.priority}`}>{priorityLabel[issue.priority]}</span>
        <span>Due {formatDue(due.accepted)}{due.proposed !== null ? <span className="proposed-tag"> · proposed {formatDue(due.proposed)}</span> : null}</span>
        {pending ? <span className="pending-badge">Pending review</span> : null}
      </p>
      <div className="card-actions">
        <label className="compact">Status
          <select value={issue.status} disabled={busy} onChange={(e) => onMove(e.target.value as IssueStatus)} aria-label={`Status of ${issue.key}`}>
            {STATUSES.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
          </select>
        </label>
        <button type="button" className="link-button" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>Change due date</button>
      </div>
      {editing ? <DueDateEditor issue={issue} pendingReview={due.proposed !== null} onDone={() => setEditing(false)} /> : null}
    </article>
  );
}

function Backlog({ projectKey, issues, changes }: { projectKey: string; issues: Issue[]; changes: ChangeView[] }) {
  return (
    <table className="issues">
      <caption className="visually-hidden">Issues in {projectKey}</caption>
      <thead><tr><th scope="col">Key</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Due</th></tr></thead>
      <tbody>
        {issues.map((i) => {
          const due = dueView(i, changes);
          return (
            <tr key={i.id}>
              <td><Link to={`/issues/${i.key}`}>{i.key}</Link></td>
              <td>{i.title}</td>
              <td>{statusLabel[i.status]}</td>
              <td>{priorityLabel[i.priority]}</td>
              <td>{formatDue(due.accepted)}{due.proposed !== null ? <span className="proposed-tag"> · proposed {formatDue(due.proposed)}</span> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
