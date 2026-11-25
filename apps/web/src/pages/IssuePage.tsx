import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import type { ChangeView, Due, IssuePatch, IssueView, NoteLink, NoteView } from "@nexus/schema";
import { ApiError, api, notePathParam } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { priorityLabel, statusLabel } from "../format";
import { extraIssue } from "../issueSlots";
import { useOpenChanges } from "../review/review";
import { revealAboveBar } from "../review/reveal";
import { BackToConversation } from "../ask/BackToConversation";
import { acknowledge } from "../issues/acknowledge";
import { DueDateNotes } from "../issues/DueDateEditor";
import { describeDue, dueFromInput, dueInputValue } from "../issues/dueEdit";

export function IssuePage() {
  const { key = "" } = useParams();
  const client = useQueryClient();
  const issue = useQuery({ queryKey: ["issue", key], queryFn: () => api.get<IssueView>(`/issues/${encodeURIComponent(key)}`) });
  // The unsaved field values, and the editing base: the issue as it was when the first field
  // was changed. They live in one state object so that a save acknowledgement can update
  // both together.
  const [draft, setDraft] = useState<{ values: IssuePatch; base: IssueView } | null>(null);
  const form = draft?.values ?? null;
  const editBase = draft?.base ?? null;
  const [conflict, setConflict] = useState<{ current: IssueView; fields: string[] } | null>(null);
  // The due value shown when the date was first changed. A chosen date keeps its time and zone,
  // as on the board and the calendar, so a timed deadline never becomes all-day (R5-12, DEC-023).
  const [dueFrom, setDueFrom] = useState<Due>(null);
  const dueNoteId = useId();
  const [params] = useSearchParams();
  const changeParam = params.get("change");
  const openHere = useOpenChanges().filter((c) => c.recordKey === key && c.state !== "prepared");
  const pendingByField = new Map<string, ChangeView>(openHere.filter((c) => c.field).map((c) => [c.field as string, c]));
  const pendingLinks = new Map<string, ChangeView>(openHere.filter((c) => c.kind === "record.addLink").map((c) => {
    const l = c.after as NoteLink;
    return [`${l.notePath}#${l.headingSlug ?? ""}`, c];
  }));
  const pendingClass = (field: string) => (pendingByField.has(field) ? ` pending-field${pendingByField.get(field)!.state === "conflicted" ? " conflicted" : ""}` : "");
  // Reveal each change once when it is reached; later refetches must not steal focus (for example from the feedback box).
  // A field change shows on its field, a new link on the link itself, and a new issue on its review note.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!changeParam || revealed.current === changeParam || !openHere.length) return;
    const id = CSS.escape(changeParam);
    const el = document.querySelector<HTMLElement>(`label[data-change-id="${id}"]`)
      ?? document.querySelector<HTMLElement>(`li[data-change-id="${id}"]`)
      ?? document.querySelector<HTMLElement>(`[data-change-id="${id}"]`);
    if (!el) return;
    revealed.current = changeParam;
    requestAnimationFrame(() => revealAboveBar(el));
  }, [changeParam, issue.dataUpdatedAt, openHere.length]);

  const refreshAfterSave = (saved: IssueView) => {
    client.setQueryData(["issue", key], saved);
    void client.invalidateQueries({ queryKey: ["issues"] });
    void client.invalidateQueries({ queryKey: ["note"] });
  };
  const onConflict = (error: unknown) => {
    if (error instanceof ApiError && error.code === "REVISION_MISMATCH") {
      const details = error.details as { current?: IssueView; conflictingFields?: string[] } | undefined;
      if (details?.current) setConflict({ current: details.current, fields: details.conflictingFields ?? [] });
      else void client.invalidateQueries({ queryKey: ["issue", key] });
    }
  };
  const update = useMutation({
    mutationFn: (input: { baseRevision: number; patch: IssuePatch; baseValues: IssuePatch }) => api.patch<IssueView>(`/issues/${encodeURIComponent(key)}`, input),
    // Like the note editor: the reply acknowledges only what was submitted. Anything typed
    // while the save was in flight stays in the form, visible and unsaved.
    onSuccess: (saved, input) => { refreshAfterSave(saved); setDraft((d) => acknowledge(d, input.patch, saved)); setConflict(null); },
    onError: onConflict,
  });
  // Link changes have their own request, so an unsaved title or description is never cleared.
  const updateLinks = useMutation({
    mutationFn: (input: { baseRevision: number; patch: IssuePatch; baseValues: IssuePatch }) => api.patch<IssueView>(`/issues/${encodeURIComponent(key)}`, input),
    onSuccess: refreshAfterSave,
    onError: onConflict,
  });

  if (issue.error) {
    const missing = issue.error instanceof ApiError && issue.error.code === "NOT_FOUND";
    return <section className="page">{missing ? <IssueGone issueKey={key} /> : <ErrorNote error={issue.error} />}<Link to="/projects">All projects</Link></section>;
  }
  if (!issue.data) return <section className="page" aria-busy="true"><p className="muted">Loading issue…</p></section>;
  // A reminder links to an issue by key and ID. Keys are never reused (R4-7), so a mismatch
  // means the link is not for this issue.
  const linkedId = params.get("id");
  if (linkedId && linkedId !== issue.data.id) {
    return <section className="page"><h1>Issue not found</h1><p role="alert">This link was for an issue that no longer exists. {issue.data.key} is a different issue.</p><Link to={`/issues/${encodeURIComponent(issue.data.key)}`}>Open {issue.data.key} anyway</Link></section>;
  }
  const i = issue.data;
  // Fields being edited show the draft; every other field shows the newest value, so others' edits stay visible.
  const value = { title: i.title, description: i.description, status: i.status, priority: i.priority, due: i.due, ...form };
  const dirty = form !== null;
  const set = (patch: IssuePatch) => setDraft((d) => ({ values: { ...d?.values, ...patch }, base: d?.base ?? i }));
  const baseValuesFor = (patch: IssuePatch, from: IssueView): IssuePatch =>
    Object.fromEntries(Object.keys(patch).map((f) => [f, from[f as keyof IssuePatch]])) as IssuePatch;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const b = editBase ?? i;
    update.mutate({ baseRevision: b.revision, patch: form, baseValues: baseValuesFor(form, b) });
  };
  const changedElsewhere = editBase && form
    ? (Object.keys(form) as Array<keyof IssuePatch>).filter((f) => JSON.stringify(i[f]) !== JSON.stringify(editBase[f]))
    : [];
  const fieldName: Record<string, string> = { title: "Title", description: "Description", status: "Status", priority: "Priority", due: "Due date", noteLinks: "Linked notes" };
  const shown = (f: string, v: unknown) => (f === "due" ? describeDue((v ?? null) as Due)
    : v === null || v === undefined ? "none" : typeof v === "string" ? v : JSON.stringify(v));
  const dueDrafted = !!form && "due" in form;
  const dueShape: Due = dueDrafted ? dueFrom : i.due; // the value whose time and zone a chosen date keeps
  const dueDate = dueInputValue(value.due ?? null);
  const changeDue = (date: string) => {
    if (!dueDrafted) setDueFrom(i.due);
    set({ due: dueFromInput(dueShape, date) });
  };

  return (
    <section className="page issue-page" aria-labelledby="issue-h">
      <BackToConversation />
      <p className="path"><Link to="/projects">Projects</Link> / <Link to={`/projects/${i.projectKey}`}>{i.projectKey}</Link> / {i.key}</p>
      <h1 id="issue-h"><span className="issue-key">{i.key}</span> {i.title}</h1>
      <ReusedKey issueKey={i.key} />
      {extraIssue.aboveFields.map((Slot, n) => <Slot key={n} issue={i} />)}
      {conflict ? (
        <div className="conflict" role="alert" data-testid="issue-conflict">
          <p><strong>Someone else changed {conflict.fields.length ? conflict.fields.map((f) => fieldName[f] ?? f).join(", ") : "this issue"} since you started editing.</strong> Your edits are still in the form. Nothing was saved.</p>
          <ul className="plain">
            {conflict.fields.map((f) => (
              <li key={f}>{fieldName[f] ?? f}: theirs “{shown(f, conflict.current[f as keyof IssueView])}”, yours “{shown(f, form?.[f as keyof IssuePatch])}”</li>
            ))}
          </ul>
          <div className="row">
            <button type="button" onClick={() => {
              const rest = Object.fromEntries(Object.entries(form ?? {}).filter(([f]) => !conflict.fields.includes(f))) as IssuePatch;
              client.setQueryData(["issue", key], conflict.current);
              setDraft(Object.keys(rest).length ? { values: rest, base: conflict.current } : null);
              setConflict(null);
            }}>Use theirs for {conflict.fields.length > 1 ? "these fields" : "this field"}</button>
            <button type="button" onClick={() => {
              if (!form) return;
              update.mutate({ baseRevision: conflict.current.revision, patch: form, baseValues: baseValuesFor(form, conflict.current) });
            }}>Keep mine</button>
          </div>
        </div>
      ) : changedElsewhere.length ? (
        <p className="notice" role="status" data-testid="changed-elsewhere">
          {changedElsewhere.map((f) => fieldName[f] ?? f).join(", ")} changed elsewhere while you were editing. Saving will ask which version to keep.
        </p>
      ) : null}
      <form className="fields-form" onSubmit={submit} aria-label="Issue details">
        <label>Title<input value={value.title} onChange={(e) => set({ title: e.target.value })} required data-field="title" /></label>
        <div className="field-row">
          <label>Status
            <select value={value.status} onChange={(e) => set({ status: e.target.value as IssuePatch["status"] })} data-field="status">
              {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={value.priority} onChange={(e) => set({ priority: e.target.value as IssuePatch["priority"] })} data-field="priority">
              {Object.entries(priorityLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="due-field">
            <label data-field-wrapper="due" className={pendingClass("due").trim() || undefined} data-change-id={pendingByField.get("due")?.changeId} tabIndex={pendingByField.has("due") ? -1 : undefined}>Due date
              <input type="date" value={dueDate} onChange={(e) => changeDue(e.target.value)} aria-describedby={dueNoteId} data-field="due" />
              {pendingByField.has("due") ? <span className="pending-badge">{pendingByField.get("due")!.state === "conflicted" ? "Conflict" : "Pending review"}</span> : null}
            </label>
            <DueDateNotes id={dueNoteId} shape={dueShape} date={dueDate} />
          </div>
        </div>
        <label>Description<textarea rows={4} value={value.description} onChange={(e) => set({ description: e.target.value })} data-field="description" /></label>
        <div className="row">
          <button type="submit" className="primary" disabled={!dirty || update.isPending}>{update.isPending ? "Saving…" : "Save issue"}</button>
          {dirty ? <button type="button" onClick={() => { setDraft(null); setConflict(null); }}>Discard changes</button> : null}
          <span className="save-state" role="status">{dirty ? "Unsaved changes" : `Saved · revision ${i.revision}`}</span>
        </div>
        {update.error && !conflict ? <ErrorNote error={update.error} /> : null}
      </form>
      <NoteLinks issue={i} busy={updateLinks.isPending} pendingLinks={pendingLinks}
        onChange={(noteLinks) => updateLinks.mutate({ baseRevision: i.revision, patch: { noteLinks }, baseValues: { noteLinks: i.noteLinks.map((l) => ({ notePath: l.notePath, headingSlug: l.headingSlug, headingText: l.headingText })) } })} />
      {updateLinks.error && !conflict ? <ErrorNote error={updateLinks.error} /> : null}
    </section>
  );
}
type ProposedIssue = { key: string; title: string; state: string; at: string; source: string; reusedBy?: string | null };

/**
 * A workspace from before run 5 may have given this issue's key to a proposal that was later
 * rejected. Links made for that proposal now lead here, so say so (R5-7).
 */
function ReusedKey({ issueKey }: { issueKey: string }) {
  const proposed = useQuery({
    queryKey: ["review", "proposed-issue", issueKey],
    queryFn: () => api.get<{ proposed: null | ProposedIssue }>(`/review/proposed-issue?key=${encodeURIComponent(issueKey)}`),
  });
  const p = proposed.data?.proposed;
  if (!p?.reusedBy) return null;
  const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(p.at));
  return (
    <p className="notice" role="note" data-testid="reused-key">
      {issueKey} was also the key of “{p.title}”, a new issue proposed by an edit ({p.source}) and {p.state === "accepted" ? "accepted" : "not kept"} on {when}.
      A link made for that proposal may have meant it, not this issue.
    </p>
  );
}

/** An issue key that does not exist: say whether it was a proposal that was rejected (R4-7). */
function IssueGone({ issueKey }: { issueKey: string }) {
  const proposed = useQuery({
    queryKey: ["review", "proposed-issue", issueKey],
    queryFn: () => api.get<{ proposed: null | { key: string; title: string; state: string; at: string; source: string } }>(`/review/proposed-issue?key=${encodeURIComponent(issueKey)}`),
  });
  const p = proposed.data?.proposed;
  const when = p ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(p.at)) : "";
  return (
    <div role="alert">
      <h1>{issueKey} does not exist</h1>
      {p && (p.state === "rejected" || p.state === "superseded")
        ? <p>{issueKey} “{p.title}” was proposed by an edit ({p.source}) and rejected on {when}, so it was never added. Nexus does not give its key to another issue.</p>
        : <p>No issue has the key {issueKey} in this workspace.</p>}
    </div>
  );
}

function NoteLinks({ issue, onChange, busy, pendingLinks }: { issue: IssueView; onChange: (links: NoteLink[]) => void; busy: boolean; pendingLinks: Map<string, ChangeView> }) {
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => api.get<{ notes: string[] }>("/notes") });
  const [notePath, setNotePath] = useState("");
  const [headingSlug, setHeadingSlug] = useState("");
  const note = useQuery({
    queryKey: ["note", notePath],
    enabled: !!notePath,
    queryFn: () => api.get<NoteView>(`/notes/content?path=${encodeURIComponent(notePath)}`),
  });
  useEffect(() => setHeadingSlug(""), [notePath]);
  const plain = (l: NoteLink): NoteLink => ({ notePath: l.notePath, headingSlug: l.headingSlug, headingText: l.headingText });

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!notePath) return;
    const h = note.data?.headings.find((x) => x.slug === headingSlug);
    const link: NoteLink = { notePath, headingSlug: h?.slug ?? null, headingText: h?.text ?? null };
    if (issue.noteLinks.some((l) => l.notePath === link.notePath && l.headingSlug === link.headingSlug)) return;
    onChange([...issue.noteLinks.map(plain), link]);
    setNotePath("");
  };

  return (
    <section className="links" aria-labelledby="links-h">
      <h2 id="links-h">Linked notes</h2>
      {issue.links.length === 0 ? <p className="muted">No notes linked yet.</p> : (
        <ul className="linked">
          {issue.links.map((l, n) => {
            const pending = pendingLinks.get(`${l.notePath}#${l.headingSlug ?? ""}`);
            return (
            <li key={`${l.notePath}#${l.headingSlug}`} className={pending ? `pending-field${pending.state === "conflicted" ? " conflicted" : ""}` : undefined}
              data-change-id={pending?.changeId} tabIndex={pending ? -1 : undefined}>
              {l.status === "note-missing" ? (
                <span className="broken-link">{l.notePath} (note not found)</span>
              ) : (
                <Link to={notePathParam(l.notePath, l.resolvedSlug)} data-testid="open-linked-note">
                  {l.notePath.replace(/\.md$/i, "")}{l.headingText ? ` › ${l.headingText}` : ""}
                </Link>
              )}
              {l.status === "heading-missing" ? <span className="muted"> (heading not found; opens the note)</span> : null}
              {pending ? <span className="pending-badge">{pending.state === "conflicted" ? "Conflict" : "Pending review"}</span> : null}
              {/* A proposed link is kept or undone with Accept or Reject above, not removed by hand. */}
              {pending ? null : (
                <button type="button" className="link-button" disabled={busy}
                  onClick={() => onChange(issue.noteLinks.filter((_, idx) => idx !== n).map(plain))}
                  aria-label={`Remove link to ${l.notePath}${l.headingText ? ` › ${l.headingText}` : ""}`}>Remove</button>
              )}
            </li>
            );
          })}
        </ul>
      )}
      <form className="inline-form" onSubmit={add} aria-label="Link a note">
        <label>Note
          <select value={notePath} onChange={(e) => setNotePath(e.target.value)} data-testid="link-note">
            <option value="">Choose a note…</option>
            {(notes.data?.notes ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>Heading
          <select value={headingSlug} onChange={(e) => setHeadingSlug(e.target.value)} disabled={!note.data} data-testid="link-heading">
            <option value="">Whole note</option>
            {(note.data?.headings ?? []).map((h) => <option key={h.slug} value={h.slug}>{"  ".repeat(h.depth - 1)}{h.text}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!notePath || busy}>Add link</button>
      </form>
    </section>
  );
}
