import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { WorkspaceView } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { useAsk, useAskStatus } from "./ask";

/**
 * The composer. Ask only reads. Edit, chosen explicitly for one message at a time, lets Nexus
 * propose changes that are written for review and kept only when the user accepts them.
 */
export function Composer({ conversationId, busy = false }: { conversationId?: string; busy?: boolean }) {
  const status = useAskStatus();
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const ask = useAsk();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"ask" | "edit">("ask");
  const available = status.data?.available === true;
  const editAvailable = available && status.data?.edit?.available === true;
  const editing = mode === "edit" && editAvailable;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || !available || busy) return;
    ask.mutate({ question: q, conversationId, mode: editing ? "edit" : "ask" }, {
      onSuccess: (id) => {
        setQuestion("");
        setMode("ask"); // Edit applies to one message; the next one is Ask again unless chosen
        if (!conversationId) navigate(`/c/${id}`);
      },
    });
  };
  const p = status.data?.profile;
  const editTitle = !available ? "Set up an AI provider first" : !editAvailable ? (status.data?.edit?.message ?? "This model cannot propose changes") : undefined;
  return (
    <form className="composer" onSubmit={submit} aria-label="Ask about your notes and projects">
      <div className="composer-head">
        <div className="segmented" role="group" aria-label="Mode">
          <button type="button" aria-pressed={!editing} onClick={() => setMode("ask")}>Ask</button>
          <button type="button" aria-pressed={editing} disabled={!editAvailable} title={editTitle} onClick={() => setMode("edit")}>Edit</button>
        </div>
        <span className="muted" id="composer-mode-note">
          {editing
            ? "Edit proposes changes to your notes and issues. Nexus writes them for you to review one at a time, and keeps only what you accept."
            : "Ask only reads. It never changes your notes or issues."}
        </span>
      </div>
      <label htmlFor="composer">{editing ? "Describe the changes for Nexus to propose" : "Ask about your notes and projects"}</label>
      <textarea id="composer" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)}
        disabled={!available || busy} aria-describedby="composer-mode-note"
        placeholder={!available ? "Set up an AI provider to ask questions" : editing ? "Create the missing issue, link it to its meeting note and update the note line" : "Which action from the kickoff still has no issue?"}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e); }} />
      <div className="composer-row">
        <span className="chip">Workspace: {workspace.data?.workspace?.name ?? "none"}</span>
        {available && p ? (
          <span className="chip" data-testid="model-chip">Model: {p.model} via {p.receivingHost}{p.fixture ? " (test double)" : ""}</span>
        ) : (
          <span className="chip" id="ai-off">AI is off</span>
        )}
        {!available ? (
          <span className="muted">{status.data?.message ?? "Checking AI…"} <Link to="/settings">Open Settings</Link>. Notes and projects work fully without it.</span>
        ) : (
          <button type="submit" className="primary" disabled={!question.trim() || ask.isPending || busy}>{ask.isPending ? "Sending…" : "Send"}</button>
        )}
      </div>
      {available && p ? <p className="muted">{editing ? "Edit" : "Ask"} sends excerpts of the notes and issues it reads to {p.receivingHost}.</p> : null}
      {available && !editAvailable && status.data?.edit?.message ? <p className="muted">{status.data.edit.message}</p> : null}
      {ask.error ? <ErrorNote error={ask.error} /> : null}
    </form>
  );
}
