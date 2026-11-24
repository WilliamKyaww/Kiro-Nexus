import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { WorkspaceView } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { useAsk, useAskStatus } from "./ask";

/** The Ask composer. Ask is read-only; Edit is shown but not available yet. */
export function Composer({ conversationId, busy = false }: { conversationId?: string; busy?: boolean }) {
  const status = useAskStatus();
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const ask = useAsk();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const available = status.data?.available === true;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || !available || busy) return;
    ask.mutate({ question: q, conversationId }, { onSuccess: (id) => { setQuestion(""); if (!conversationId) navigate(`/c/${id}`); } });
  };
  const p = status.data?.profile;
  return (
    <form className="composer" onSubmit={submit} aria-label="Ask about your notes and projects">
      <div className="composer-head">
        <div className="segmented" role="group" aria-label="Mode">
          <button type="button" aria-pressed="true">Ask</button>
          <button type="button" aria-pressed="false" disabled title="Editing through the assistant is not available yet">Edit</button>
        </div>
        <span className="muted">Ask only reads. It never changes your notes or issues.</span>
      </div>
      <label htmlFor="composer">Ask about your notes and projects</label>
      <textarea id="composer" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)}
        disabled={!available || busy}
        placeholder={available ? "Which action from the kickoff still has no issue?" : "Set up an AI provider to ask questions"}
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
      {available && p ? <p className="muted">Ask sends excerpts of the notes and issues it reads to {p.receivingHost}.</p> : null}
      {ask.error ? <ErrorNote error={ask.error} /> : null}
    </form>
  );
}
