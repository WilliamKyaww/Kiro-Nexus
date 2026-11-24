import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import type { ChangeView, IssuePatch, IssueView, NoteLink, NoteView } from "@nexus/schema";
import { ApiError, api, notePathParam } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { priorityLabel, statusLabel } from "../format";
import { extraIssue } from "../issueSlots";
import { useOpenChanges } from "../review/review";
import { revealAboveBar } from "../review/reveal";
import { BackToConversation } from "../ask/BackToConversation";
import { acknowledge } from "../issues/acknowledge";

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
  const [params] = useSearchParams();
  const changeParam = params.get("change");
  const pendingByField = new Map<string, ChangeView>(useOpenChanges().filter((c) => c.recordKey === key && c.field && c.state !== "prepared").map((c) => [c.field as string, c]));
  const pendingClass = (field: string) => (pendingByField.has(field) ? ` pending-field${pendingByField.get(field)!.state === "conflicted" ? " conflicted" : ""}` : "");
  // Reveal each change once when it is reached; later refetches must not steal focus (for example from the feedback box).
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!changeParam || revealed.current === changeParam || !pendingByField.size) return;
    const el = document.querySelector<HTMLElement>(`label[data-change-id="${CSS.escape(changeParam)}"]`)
      ?? document.querySelector<HTMLElement>(`[data-change-id="${CSS.escape(changeParam)}"]`);
    if (!el) return;
    revealed.current = changeParam;
    requestAnimationFrame(() => revealAboveBar(el));
  }, [changeParam, issue.dataUpdatedAt, pendingByField.size]);

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

  if (issue.error) return <section className="page"><ErrorNote error={issue.error} /><Link to="/projects">All projects</Link></section>;
  if (!issue.data) return <section className="page" aria-busy="true"><p className="muted">Loading issue…</p></section>;
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
  const shown = (v: unknown) => (v === null || v === undefined ? "none" : typeof v === "string" ? v : JSON.stringify(v));
  const dueDate = value.due && "date" in value.due ? value.due.date : "";

  return (
    <section className="page issue-page" aria-labelledby="issue-h">
      <BackToConversation />
      <p className="path"><Link to="/projects">Projects</Link> / <Link to={`/projects/${i.projectKey}`}>{i.projectKey}</Link> / {i.key}</p>
      <h1 id="issue-h"><span className="issue-key">{i.key}</span> {i.title}</h1>
      {extraIssue.aboveFields.map((Slot, n) => <Slot key={n} issue={i} />)}
      {conflict ? (
        <div className="conflict" role="alert" data-testid="issue-conflict">
          <p><strong>Someone else changed {conflict.fields.length ? conflict.fields.map((f) => fieldName[f] ?? f).join(", ") : "this issue"} since you started editing.</strong> Your edits are still in the form. Nothing was saved.</p>
          <ul className="plain">
            {conflict.fields.map((f) => (
              <li key={f}>{fieldName[f] ?? f}: theirs “{shown(conflict.current[f as keyof IssueView])}”, yours “{shown(form?.[f as keyof IssuePatch])}”</li>
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
          <label data-field-wrapper="due" className={pendingClass("due").trim() || undefined} data-change-id={pendingByField.get("due")?.changeId} tabIndex={pendingByField.has("due") ? -1 : undefined}>Due date
            <input type="date" value={dueDate} onChange={(e) => set({ due: e.target.value ? { date: e.target.value } : null })} data-field="due" />
            {pendingByField.has("due") ? <span className="pending-badge">{pendingByField.get("due")!.state === "conflicted" ? "Conflict" : "Pending review"}</span> : null}
          </label>
        </div>
        <label>Description<textarea rows={4} value={value.description} onChange={(e) => set({ description: e.target.value })} data-field="description" /></label>
        <div className="row">
          <button type="submit" className="primary" disabled={!dirty || update.isPending}>{update.isPending ? "Saving…" : "Save issue"}</button>
          {dirty ? <button type="button" onClick={() => { setDraft(null); setConflict(null); }}>Discard changes</button> : null}
          <span className="save-state" role="status">{dirty ? "Unsaved changes" : `Saved · revision ${i.revision}`}</span>
        </div>
        {update.error && !conflict ? <ErrorNote error={update.error} /> : null}
      </form>
      <NoteLinks issue={i} busy={updateLinks.isPending}
        onChange={(noteLinks) => updateLinks.mutate({ baseRevision: i.revision, patch: { noteLinks }, baseValues: { noteLinks: i.noteLinks.map((l) => ({ notePath: l.notePath, headingSlug: l.headingSlug, headingText: l.headingText })) } })} />
      {updateLinks.error && !conflict ? <ErrorNote error={updateLinks.error} /> : null}
    </section>
  );
}
function NoteLinks({ issue, onChange, busy }: { issue: IssueView; onChange: (links: NoteLink[]) => void; busy: boolean }) {
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
          {issue.links.map((l, n) => (
            <li key={`${l.notePath}#${l.headingSlug}`}>
              {l.status === "note-missing" ? (
                <span className="broken-link">{l.notePath} (note not found)</span>
              ) : (
                <Link to={notePathParam(l.notePath, l.resolvedSlug)} data-testid="open-linked-note">
                  {l.notePath.replace(/\.md$/i, "")}{l.headingText ? ` › ${l.headingText}` : ""}
                </Link>
              )}
              {l.status === "heading-missing" ? <span className="muted"> (heading not found; opens the note)</span> : null}
              <button type="button" className="link-button" disabled={busy}
                onClick={() => onChange(issue.noteLinks.filter((_, idx) => idx !== n).map(plain))}
                aria-label={`Remove link to ${l.notePath}${l.headingText ? ` › ${l.headingText}` : ""}`}>Remove</button>
            </li>
          ))}
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
