// The note editor's textarea with [[ completion (backlinks-completion, requirement 3).
// Typing [[ lists notes, # after a name lists that note's headings, | starts a free alias.
// Arrow keys move, Enter or Tab inserts, Escape dismisses. Insertion goes through the
// browser's own text input, so Undo works and the draft store sees an ordinary edit.
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NoteView } from "@nexus/schema";
import { api } from "../api";
import { reviewBarHeight } from "../review/reveal";
import { completableLinkAt, completion, headingNoteProblem, headingSuggestions, linkAt, noteSuggestions, type Suggestion } from "./wikilinks";

/** Space between the caret's line and the list. */
const GAP = 4;

/** Where the caret is drawn inside a textarea, measured with a mirror element. */
function caretPoint(el: HTMLTextAreaElement, pos: number): { top: number; left: number; lineHeight: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const p of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "tabSize"] as const) {
    mirror.style[p] = style[p];
  }
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  mirror.textContent = el.value.slice(0, pos);
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  mirror.append(mark);
  document.body.append(mirror);
  const point = { top: mark.offsetTop - el.scrollTop, left: mark.offsetLeft - el.scrollLeft, lineHeight: parseFloat(style.lineHeight) || 20 };
  mirror.remove();
  return point;
}

export function WikilinkEditor({ id, value, onChange, notes, path, describedBy }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  notes: readonly string[];
  /** The note being edited, so a shared name resolves to the closest note. */
  path: string;
  describedBy?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [point, setPoint] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Not in code: the preview would not make a link there either (R6-16).
  const token = useMemo(() => (caret === null ? null : completableLinkAt(value, caret)), [value, caret]);
  const wanted = token && token.part !== "alias" && dismissed !== token.start ? token : null;
  const headingNote = wanted?.part === "heading" ? headingNoteProblem(wanted, notes, path) : null;
  const headingPath = headingNote && "path" in headingNote ? headingNote.path : null;
  const target = useQuery({
    queryKey: ["note", headingPath ?? ""],
    enabled: !!headingPath,
    queryFn: () => api.get<NoteView>(`/notes/content?path=${encodeURIComponent(headingPath!)}`),
  });
  const { options, status } = useMemo((): { options: Suggestion[]; status: string | null } => {
    if (!wanted) return { options: [], status: null };
    if (wanted.part === "target") {
      const found = noteSuggestions(wanted.query, notes);
      return { options: found, status: found.length ? null : `No note matches “${wanted.query.trim()}”.` };
    }
    if (headingNote && "message" in headingNote) return { options: [], status: headingNote.message };
    if (!target.data) return { options: [], status: target.isError ? "Nexus could not read that note's headings." : "Reading the headings…" };
    const found = headingSuggestions(wanted.query, target.data.headings, target.data.content);
    return { options: found, status: found.length ? null : target.data.headings.length ? `“${wanted.target}” has no heading matching “${wanted.query.trim()}”.` : `“${wanted.target}” has no headings.` };
  }, [wanted?.part, wanted?.query, wanted?.target, notes, headingNote && "message" in headingNote ? headingNote.message : headingPath, target.data, target.isError]);
  const open = !!wanted && (options.length > 0 || status !== null);
  const current = options.length ? Math.min(active, options.length - 1) : -1;

  // Keep the list at the caret and inside the part of the editor on screen (R6-15): below the
  // caret's line when it fits there, otherwise above it, otherwise on the roomier side, shortened.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = popup.current;
    if (!open || !el || !box || caret === null) { setPoint(null); return; }
    const p = caretPoint(el, caret);
    const left = Math.max(0, Math.min(p.left, el.clientWidth - box.offsetWidth));
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const full = Math.min(box.scrollHeight + (box.offsetHeight - box.clientHeight), 16 * rem);
    const r = el.getBoundingClientRect();
    const lineTop = Math.max(0, Math.min(p.top, el.clientHeight - p.lineHeight));
    const lineBottom = lineTop + p.lineHeight;
    const shownTop = Math.max(0, -r.top);
    const shownBottom = Math.min(el.offsetHeight, window.innerHeight - reviewBarHeight() - r.top);
    const below = shownBottom - lineBottom - GAP;
    const above = lineTop - GAP - shownTop;
    const least = Math.min(full, 4 * rem);
    if (below >= full || (below >= above && below >= least)) {
      const maxHeight = Math.min(full, below);
      setPoint({ top: lineBottom + GAP, left, maxHeight });
    } else {
      const maxHeight = Math.max(Math.min(full, above), least);
      setPoint({ top: lineTop - GAP - maxHeight, left, maxHeight });
    }
  }, [open, caret, value, options.length, status]);

  // Keep the current option inside the list's visible part on every move (R6-15).
  useLayoutEffect(() => {
    const box = popup.current;
    if (!open || !box || !point || current < 0) return;
    const row = document.getElementById(`${listId}-${current}`);
    if (!row) return;
    const b = box.getBoundingClientRect();
    const o = row.getBoundingClientRect();
    const top = b.top + box.clientTop;
    const bottom = top + box.clientHeight;
    const pad = parseFloat(getComputedStyle(box).paddingTop) || 0;
    if (o.top < top + pad) box.scrollTop -= top + pad - o.top;
    else if (o.bottom > bottom - pad) box.scrollTop += o.bottom - (bottom - pad);
  }, [open, current, point, listId]);

  const track = () => {
    const el = ref.current;
    if (!el) return;
    const at = el.selectionStart === el.selectionEnd ? el.selectionStart : null;
    setCaret(at);
    if (at === null || !linkAt(el.value, at)) setDismissed(null);
  };

  const insert = (s: Suggestion) => {
    const el = ref.current;
    if (!el || !wanted) return;
    const edit = completion(wanted, s.value);
    el.focus();
    el.setSelectionRange(edit.from, edit.to);
    // insertText keeps the browser's undo history and fires the input event React listens to.
    const done = typeof document.execCommand === "function" && document.execCommand("insertText", false, edit.insert);
    if (!done) {
      el.setRangeText(edit.insert, edit.from, edit.to, "end");
      onChange(el.value);
    }
    el.setSelectionRange(edit.caret, edit.caret);
    setCaret(edit.caret);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || !wanted) return;
    if (e.key === "Escape") { e.preventDefault(); setDismissed(wanted.start); return; }
    if (!options.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((current + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((current - 1 + options.length) % options.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(options[current]!); }
  };

  return (
    <div className="wikilink-editor">
      <textarea
        id={id}
        ref={ref}
        value={value}
        spellCheck
        aria-describedby={describedBy}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && current >= 0 ? `${listId}-${current}` : undefined}
        onChange={(e) => { onChange(e.target.value); setActive(0); track(); }}
        onSelect={track}
        onKeyDown={onKeyDown}
        onBlur={() => setCaret(null)}
      />
      {open ? (
        // Rendered unplaced first, so its height can be measured before it is shown.
        <div ref={popup} className="link-suggest" style={point ? { top: point.top, left: point.left, maxHeight: point.maxHeight } : { top: 0, left: 0, visibility: "hidden" }}>
          {options.length ? (
            <ul id={listId} role="listbox" aria-label={wanted!.part === "heading" ? `Headings in ${wanted!.target}` : "Notes to link"}>
              {options.map((s, i) => (
                <li
                  key={s.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  // mousedown, not click: the textarea keeps focus and its caret.
                  onMouseDown={(e) => { e.preventDefault(); insert(s); }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="link-suggest-label">{s.label}</span>
                  {s.detail ? <span className="link-suggest-detail"><span className="visually-hidden">{s.kind === "note" ? ", in " : ", "}</span>{s.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {status ? <p className="link-suggest-status">{status}</p> : null}
        </div>
      ) : null}
      <span className="visually-hidden" role="status" aria-live="polite">
        {open ? (options.length ? `${options.length} ${wanted!.part === "heading" ? "heading" : "note"}${options.length === 1 ? "" : "s"}. Up and down to choose, Enter to insert, Escape to close.` : status) : ""}
      </span>
    </div>
  );
}
