import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Issue, NoteView, WorkspaceView } from "@nexus/schema";
import { ApiError, api, notePathParam } from "../api";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { ErrorNote } from "../components/ErrorNote";
import { extraNotes } from "../noteSlots";
import { useOpenChanges } from "../review/review";
import { NoteSearch } from "../components/NoteSearch";
import { drafts } from "../notes/drafts";
import { revealAboveBar } from "../review/reveal";
import { BackToConversation } from "../ask/BackToConversation";
import { checkCitedSection, resolveHeadingParam, type HeadingAlias, type HeadingRef } from "../notes/headings";

/** Workspace identity that scopes drafts; "none" before a workspace is known. */
function useWorkspaceId(): string {
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  return workspace.data?.workspace?.workspaceId ?? "none";
}

export function NotesPage() {
  const [params] = useSearchParams();
  const path = params.get("path");
  const heading = params.get("heading");
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => api.get<{ notes: string[] }>("/notes") });
  const wsId = useWorkspaceId();
  useSyncExternalStore(drafts.subscribe, drafts.version);
  const withDrafts = new Set(drafts.paths(wsId));

  return (
    <div className={path ? "notes-layout has-note" : "notes-layout"}>
      <aside className="note-list" aria-label="Notes">
        <h1 className="section-title">Notes</h1>
        <NoteSearch />
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
                  {withDrafts.has(p) ? <span className="draft-dot"> · unsaved draft</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
        {notes.isSuccess && notes.data.notes.length === 0 ? <p className="muted">No notes yet. Create one above.</p> : null}
      </aside>
      {path ? <NoteEditor key={`${wsId}:${path}`} wsId={wsId} path={path} heading={heading} allNotes={notes.data?.notes ?? []} /> : (
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

/**
 * Save behaviour (documented in docs/data-format.md "Drafts and saving"):
 * - Typing creates a draft in the tab's draft store, keyed by workspace and note,
 *   with the note revision at the moment the draft began as its editing base.
 * - Save submits the current text with that base. On success only the submitted
 *   text is cleared; text typed while the save was in flight stays as a draft.
 * - A stale base (the file changed) never overwrites: both texts are shown and the
 *   user chooses.
 */
function NoteEditor({ wsId, path, heading, allNotes }: { wsId: string; path: string; heading: string | null; allNotes: string[] }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const note = useQuery({ queryKey: ["note", path], queryFn: () => api.get<NoteView>(`/notes/content?path=${encodeURIComponent(path)}`) });
  const issues = useQuery({ queryKey: ["issues", "all"], queryFn: () => api.get<{ issues: Issue[] }>("/issues") });
  const issueKeys = useMemo(() => new Set((issues.data?.issues ?? []).map((i) => i.key)), [issues.data]);
  const stored = useSyncExternalStore(drafts.subscribe, () => drafts.get(wsId, path));
  const draft = stored?.text ?? null;
  const changeParam = params.get("change");
  const [mode, setMode] = useState<"preview" | "edit">(
    (params.get("edit") === "1" || stored !== null) && !heading && !changeParam ? "edit" : "preview",
  );
  const [restored] = useState(stored !== null);
  const openChanges = useOpenChanges().filter((c) => c.kind === "note.replaceSpan" && c.file === path);
  const pendingBlocks = openChanges.flatMap((c) => (c.lines ? [{ start: c.lines.start, end: c.lines.end, changeId: c.changeId, state: c.state }] : []));
  const [conflict, setConflict] = useState<{ content: string; revision: string } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const base = stored?.base ?? note.data?.revision ?? null;
  // A newer file on disk while a draft is open: keep the draft, flag the difference.
  const diskChanged = !!(note.data && stored && note.data.revision !== stored.base && !conflict);

  const save = useMutation({
    mutationFn: (body: { content: string; baseRevision: string }) => api.put<NoteView>("/notes/content", { path, ...body }),
    onSuccess: (saved, submitted) => {
      client.setQueryData(["note", path], saved);
      drafts.acknowledgeSave(wsId, path, submitted.content, saved.revision);
      setConflict(null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "REVISION_MISMATCH") {
        setConflict((error.details as { current: { content: string; revision: string } }).current);
      }
    },
  });

  const text = draft ?? note.data?.content ?? "";
  const dirty = draft !== null && draft !== note.data?.content;
  const setText = (value: string) => {
    if (!note.data) return;
    drafts.set(wsId, path, value, stored?.base ?? note.data.revision);
  };
  const discardDraft = () => { drafts.clear(wsId, path); setConflict(null); };
  const doSave = () => { if (draft !== null && base && !save.isPending) save.mutate({ content: draft, baseRevision: base }); };

  // Scroll to and indicate the linked heading. A heading moved by a reviewed change (pending,
  // accepted or rejected) is found by following the move. An Ask citation names a heading of
  // the accepted text at the time of the answer, so it always consults the moves: its slug may
  // exist on disk as a different section (R4-8).
  const ref: HeadingRef = params.get("ref") === "accepted" ? { ref: "accepted", at: params.get("at") } : {};
  const headingMissing = !!(heading && note.data && !note.data.headings.some((h) => h.slug === heading));
  const aliases = useQuery({
    queryKey: ["review", "heading-aliases", path],
    enabled: headingMissing || (!!heading && ref.ref === "accepted"),
    queryFn: () => api.get<{ aliases: HeadingAlias[] }>(`/review/heading-aliases?path=${encodeURIComponent(path)}`),
  });
  const aliasesReady = !(ref.ref === "accepted" && heading) || aliases.isSuccess || aliases.isError;
  const excerpt = ref.ref === "accepted" ? params.get("excerpt") : null;
  const resolved = useMemo(() => {
    if (!(heading && note.data && aliasesReady)) return null;
    const r = resolveHeadingParam(heading, note.data.headings.map((h) => h.slug), aliases.data?.aliases ?? [], ref);
    if (!r) return null;
    // A citation also checks the text it read, so a heading of the same name added above the
    // cited one does not take its place (R5-10).
    const checked = checkCitedSection(note.data.content, note.data.headings, r.slug, excerpt);
    return { ...r, slug: checked.slug, moved: checked.moved, uncertain: checked.uncertain || r.via?.reason === "uncertain" };
  }, [heading, note.data, aliases.data, aliasesReady, ref.ref, ref.at, excerpt]);
  const targetSlug = resolved?.slug ?? null;
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
  const revealedChange = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "preview" || !changeParam || revealedChange.current === changeParam) return;
    const el = previewRef.current?.querySelector<HTMLElement>(`[data-change-id="${CSS.escape(changeParam)}"]`);
    if (!el) return;
    revealedChange.current = changeParam;
    // Wait a frame so the review bar has its final height before measuring.
    requestAnimationFrame(() => revealAboveBar(el));
  }, [changeParam, mode, note.dataUpdatedAt, pendingBlocks.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); doSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    // Drafts survive navigation and reloads in this tab, but not closing it.
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const deletedOutside = note.error instanceof ApiError && note.error.code === "NOT_FOUND" && draft !== null;
  const recreate = async () => {
    if (draft === null) return;
    await api.post<NoteView>("/notes", { path, content: draft });
    drafts.clear(wsId, path);
    await client.invalidateQueries({ queryKey: ["note", path] });
    await client.invalidateQueries({ queryKey: ["notes"] });
  };
  if (note.error && !deletedOutside) return <section className="note-main"><ErrorNote error={note.error} /></section>;
  if (!note.data) return <section className="note-main" aria-busy="true"><p className="muted">Loading note…</p></section>;
  const n = note.data;
  const status = save.isPending ? "Saving…" : dirty ? "Unsaved changes" : "Saved";

  return (
    <>
      <section className="note-main" aria-labelledby="note-title">
        <BackToConversation />
        <div className="note-toolbar">
          <p className="path" id="note-title">{n.path}</p>
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Preview</button>
            <button type="button" aria-pressed={mode === "edit"} onClick={() => { setMode("edit"); if (heading) setParams({ path }); }}>Edit</button>
          </div>
          <button type="button" className="primary" onClick={doSave} disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
          <span className="save-state" role="status">{status}</span>
        </div>
        {restored && draft !== null && !conflict && !diskChanged ? (
          <div className="notice" role="note" data-testid="draft-restored">
            <p>Your unsaved draft of this note is restored. Save it, or discard it to see the file.</p>
            <button type="button" className="link-button" onClick={discardDraft}>Discard draft</button>
          </div>
        ) : null}
        {heading && !targetSlug && (!headingMissing || !aliases.isPending) ? <p className="notice">The linked heading was not found in this note. It may have been renamed.</p> : null}
        {resolved?.moved ? (
          <p className="notice" role="status" data-testid="heading-moved">Another heading with the same name was added above this section since the answer was given. This is the section the answer read.</p>
        ) : resolved?.uncertain ? (
          <p className="notice" role="status" data-testid="heading-uncertain">This note has more than one heading with this name, and Nexus cannot tell which one the answer read. Check the others with the same name too.</p>
        ) : resolved?.via ? (
          <p className="notice" role="status" data-testid="heading-alias">
            {resolved.via.reason === "pending-rename"
              ? <>This heading has a rename awaiting review. It now reads “{resolved.via.toText}”.</>
              : resolved.via.reason === "renamed"
                ? <>This heading was renamed to “{resolved.via.toText}” by an accepted change.</>
                : <>A proposed rename of this heading was rejected, so it reads “{resolved.via.toText}” again.</>}
          </p>
        ) : null}
        {conflict ? (
          <div className="conflict" role="alert" data-testid="compare">
            <p><strong>The file and your draft differ.</strong> Compare them, then choose which to keep. Nothing is overwritten until you choose.</p>
            <div className="compare">
              <section aria-label="On disk now">
                <h3>On disk now</h3>
                <pre data-testid="compare-disk">{conflict.content}</pre>
              </section>
              <section aria-label="Your draft">
                <h3>Your draft</h3>
                <pre data-testid="compare-draft">{draft ?? ""}</pre>
              </section>
            </div>
            <div className="row">
              <button type="button" onClick={() => { discardDraft(); void client.invalidateQueries({ queryKey: ["note", path] }); }}>Load latest (discard mine)</button>
              <button type="button" onClick={() => { if (draft !== null) save.mutate({ content: draft, baseRevision: conflict.revision }); }}>Overwrite with mine</button>
              <button type="button" className="link-button" onClick={() => setConflict(null)}>Keep editing</button>
            </div>
          </div>
        ) : null}
        {deletedOutside ? (
          <div className="conflict" role="alert" data-testid="deleted-outside">
            <p><strong>This note was deleted outside the editor.</strong> Your unsaved text is kept here.</p>
            <div className="row"><button type="button" onClick={() => void recreate()}>Recreate with my text</button></div>
          </div>
        ) : null}
        {diskChanged && !deletedOutside ? (
          <div className="conflict" role="alert" data-testid="disk-changed">
            <p><strong>This note was changed outside the editor.</strong> Your unsaved text is kept. Compare to see both versions.</p>
            <div className="row">
              <button type="button" onClick={discardDraft}>Load the new version (discard mine)</button>
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
            <textarea value={text} spellCheck onChange={(e) => setText(e.target.value)} aria-describedby="save-help" />
            <span id="save-help" className="muted">Ctrl+S saves. Nexus writes exactly this text to the .md file. Unsaved drafts stay in this tab when you switch pages.</span>
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
