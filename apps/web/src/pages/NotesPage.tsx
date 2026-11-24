import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Issue, NoteView } from "@nexus/schema";
import { ApiError, api, notePathParam } from "../api";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { ErrorNote } from "../components/ErrorNote";
import { extraNotes } from "../noteSlots";
import { useOpenChanges } from "../review/review";

export function NotesPage() {
  const [params] = useSearchParams();
  const path = params.get("path");
  const heading = params.get("heading");
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => api.get<{ notes: string[] }>("/notes") });

  return (
    <div className="notes-layout">
      <aside className="note-list" aria-label="Notes">
        <h1 className="section-title">Notes</h1>
        {extraNotes.sidebarTop.map((Slot, i) => <Slot key={i} />)}
        <NewNoteForm existing={notes.data?.notes ?? []} />
        {notes.error ? <ErrorNote error={notes.error} /> : null}
        <ul className="tree">
          {(notes.data?.notes ?? []).map((p) => {
            const parts = p.split("/");
            const name = (parts.pop() ?? p).replace(/\.md$/i, "");
            return (
              <li key={p}>
                <Link to={notePathParam(p)} aria-current={p === path ? "page" : undefined}>
                  {parts.length ? <span className="folder">{parts.join(" / ")} / </span> : null}{name}
                </Link>
              </li>
            );
          })}
        </ul>
        {notes.isSuccess && notes.data.notes.length === 0 ? <p className="muted">No notes yet. Create one above.</p> : null}
      </aside>
      {path ? <NoteEditor key={path} path={path} heading={heading} allNotes={notes.data?.notes ?? []} /> : (
        <section className="note-empty"><p>Choose a note, or create one.</p></section>
      )}
    </div>
  );
}

function NewNoteForm({ existing }: { existing: string[] }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const create = useMutation({
    mutationFn: (input: { path: string; content: string }) => api.post<NoteView>("/notes", input),
    onSuccess: (note) => {
      void client.invalidateQueries({ queryKey: ["notes"] });
      setTitle("");
      navigate(notePathParam(note.path) + "&edit=1");
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    const dir = folder.trim().replace(/^[/\\]+|[/\\]+$/g, "");
    create.mutate({ path: `${dir ? dir + "/" : ""}${clean}.md`, content: `# ${clean}\n\n` });
  };
  return (
    <form className="new-note" onSubmit={submit} aria-label="Create a note">
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting notes" required /></label>
      <label>Folder (optional)<input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="meetings" list="known-folders" /></label>
      <datalist id="known-folders">
        {[...new Set(existing.map((p) => p.split("/").slice(0, -1).join("/")).filter(Boolean))].map((f) => <option key={f} value={f} />)}
      </datalist>
      <button type="submit" disabled={create.isPending}>Create note</button>
      {create.error ? <ErrorNote error={create.error} /> : null}
    </form>
  );
}

function NoteEditor({ path, heading, allNotes }: { path: string; heading: string | null; allNotes: string[] }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const note = useQuery({ queryKey: ["note", path], queryFn: () => api.get<NoteView>(`/notes/content?path=${encodeURIComponent(path)}`) });
  const issues = useQuery({ queryKey: ["issues", "all"], queryFn: () => api.get<{ issues: Issue[] }>("/issues") });
  const issueKeys = useMemo(() => new Set((issues.data?.issues ?? []).map((i) => i.key)), [issues.data]);
  const changeParam = params.get("change");
  const [mode, setMode] = useState<"preview" | "edit">(params.get("edit") === "1" && !heading && !changeParam ? "edit" : "preview");
  const openChanges = useOpenChanges().filter((c) => c.kind === "note.replaceSpan" && c.file === path);
  const pendingBlocks = openChanges.flatMap((c) => (c.lines ? [{ start: c.lines.start, end: c.lines.end, changeId: c.changeId, state: c.state }] : []));
  const [draft, setDraft] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ content: string; revision: string } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Adopt the server copy when there is no unsaved draft.
  useEffect(() => {
    if (note.data && draft === null) setBase(note.data.revision);
  }, [note.data, draft]);
  // A newer server copy while a draft is open: keep the draft, flag the difference.
  const diskChanged = !!(note.data && draft !== null && base !== null && note.data.revision !== base && !conflict);

  const save = useMutation({
    mutationFn: (body: { content: string; baseRevision: string }) => api.put<NoteView>("/notes/content", { path, ...body }),
    onSuccess: (saved) => {
      client.setQueryData(["note", path], saved);
      setBase(saved.revision);
      setDraft(null);
      setConflict(null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "REVISION_MISMATCH") {
        setConflict((error.details as { current: { content: string; revision: string } }).current);
      }
    },
  });

  const dirty = draft !== null && draft !== note.data?.content;
  const text = draft ?? note.data?.content ?? "";
  const doSave = () => { if (draft !== null && base) save.mutate({ content: draft, baseRevision: base }); };

  // Scroll to and indicate the linked heading.
  const targetSlug = useMemo(() => {
    if (!heading || !note.data) return null;
    return note.data.headings.some((h) => h.slug === heading) ? heading : null;
  }, [heading, note.data]);
  useEffect(() => {
    if (mode !== "preview" || !targetSlug) return;
    const el = previewRef.current?.querySelector<HTMLElement>(`#h-${CSS.escape(targetSlug)}`);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }, [targetSlug, mode, note.dataUpdatedAt]);

  // Reaching a change: switch to preview, scroll to and briefly highlight the exact block.
  useEffect(() => { if (changeParam) setMode("preview"); }, [changeParam]);
  useEffect(() => {
    if (mode !== "preview" || !changeParam) return;
    const el = previewRef.current?.querySelector<HTMLElement>(`[data-change-id="${CSS.escape(changeParam)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }, [changeParam, mode, note.dataUpdatedAt, pendingBlocks.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); doSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (note.error) return <section className="note-main"><ErrorNote error={note.error} /></section>;
  if (!note.data) return <section className="note-main" aria-busy="true"><p className="muted">Loading note…</p></section>;
  const n = note.data;

  return (
    <>
      <section className="note-main" aria-labelledby="note-title">
        <div className="note-toolbar">
          <p className="path" id="note-title">{n.path}</p>
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Preview</button>
            <button type="button" aria-pressed={mode === "edit"} onClick={() => { setMode("edit"); if (heading) setParams({ path }); }}>Edit</button>
          </div>
          <button type="button" className="primary" onClick={doSave} disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
          <span className="save-state" role="status">{dirty ? "Unsaved changes" : "Saved"}</span>
        </div>
        {heading && !targetSlug ? <p className="notice">The linked heading was not found in this note. It may have been renamed.</p> : null}
        {conflict ? (
          <div className="conflict" role="alert">
            <p><strong>This note changed since you opened it.</strong> Your unsaved text is still in the editor.</p>
            <div className="row">
              <button type="button" onClick={() => { setDraft(null); setConflict(null); setBase(conflict.revision); void client.invalidateQueries({ queryKey: ["note", path] }); }}>Load latest (discard mine)</button>
              <button type="button" onClick={() => { if (draft !== null) save.mutate({ content: draft, baseRevision: conflict.revision }); }}>Overwrite with mine</button>
            </div>
          </div>
        ) : null}
        {diskChanged ? (
          <div className="conflict" role="alert" data-testid="disk-changed">
            <p><strong>This note was changed outside the editor.</strong> Your unsaved text is kept. Saving will ask how to resolve it.</p>
            <div className="row">
              <button type="button" onClick={() => { setDraft(null); setBase(n.revision); }}>Load the new version (discard mine)</button>
              <button type="button" onClick={() => setConflict({ content: n.content, revision: n.revision })}>Compare and choose</button>
            </div>
          </div>
        ) : null}
        {openChanges.length > 0 ? (
          <p className="notice" role="note">
            {openChanges.length === 1 ? "1 change in this note is" : `${openChanges.length} changes in this note are`} awaiting review
            {mode === "edit" ? ". Switch to Preview to see where." : ". Use the review bar to accept or reject."}
          </p>
        ) : null}
        {extraNotes.aboveContent.map((Slot, i) => <Slot key={i} path={n.path} />)}
        {mode === "edit" ? (
          <label className="editor">
            <span className="visually-hidden">Markdown for {n.path}</span>
            <textarea value={text} spellCheck onChange={(e) => setDraft(e.target.value)} aria-describedby="save-help" />
            <span id="save-help" className="muted">Ctrl+S saves. Nexus writes exactly this text to the .md file.</span>
          </label>
        ) : (
          <div ref={previewRef}>
            <MarkdownPreview content={text} notes={allNotes} issueKeys={issueKeys} targetSlug={targetSlug} pending={draft === null ? pendingBlocks : []} />
          </div>
        )}
        {save.error && !(save.error instanceof ApiError && save.error.code === "REVISION_MISMATCH") ? <ErrorNote error={save.error} /> : null}
      </section>
      <aside className="note-side" aria-label="About this note">
        <h2>Outline</h2>
        {n.headings.length === 0 ? <p className="muted">No headings.</p> : (
          <ul className="outline">
            {n.headings.map((h) => (
              <li key={h.slug} style={{ paddingLeft: `${(h.depth - 1) * 0.75}rem` }}>
                <Link to={notePathParam(n.path, h.slug)}>{h.text || "(untitled)"}</Link>
              </li>
            ))}
          </ul>
        )}
        <h2>Linked issues</h2>
        {n.linkedIssues.length === 0 ? <p className="muted">No issues link to this note yet. Link one from an issue page.</p> : (
          <ul className="linked">
            {n.linkedIssues.map((l) => (
              <li key={`${l.key}-${l.headingSlug}`}>
                <Link to={`/issues/${l.key}`}>{l.key} {l.title}</Link>
                <span className="muted"> · {l.headingText ? `to ${l.headingText}` : "whole note"}{l.linkStatus !== "ok" ? " (heading not found)" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}
