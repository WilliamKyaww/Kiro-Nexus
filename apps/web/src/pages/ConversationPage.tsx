import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorNote } from "../components/ErrorNote";
import { AnswerCard } from "../ask/AnswerCard";
import { Composer } from "../ask/Composer";
import { EditCard } from "../ask/EditCard";
import { cancelRun, editRunsToOpen, useAsk, useConversation, useProgress, type Message } from "../ask/ask";
import { changeUrl } from "../review/review";

function Running({ message }: { message: Message }) {
  const activity = useProgress(message.runId);
  return (
    <div className="running" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> {activity ?? "Working…"}
      <button type="button" onClick={() => message.runId && void cancelRun(message.runId)}>Cancel</button>
    </div>
  );
}

/**
 * Retry a failed turn with the authority it had. An Edit that already proposed changes says so
 * and asks before sending it again, because a second run could propose them again.
 */
function RetryButton({ message, edit, disabled, onRetry }: { message: Message; edit: boolean; disabled: boolean; onRetry: () => void }) {
  const [asking, setAsking] = useState(false);
  const proposed = message.edit?.changes.length ?? 0;
  if (asking) {
    return (
      <div className="row" role="group" aria-label="Retry this Edit">
        <span>This Edit already proposed {proposed === 1 ? "a change" : `${proposed} changes`}, listed below, which you can still review. Send the request again anyway?</span>
        <button type="button" className="primary" disabled={disabled} onClick={() => { setAsking(false); onRetry(); }}>Retry Edit anyway</button>
        <button type="button" onClick={() => setAsking(false)}>Cancel</button>
      </div>
    );
  }
  return <button type="button" disabled={disabled} onClick={() => (edit && proposed ? setAsking(true) : onRetry())}>{edit ? "Retry Edit" : "Retry"}</button>;
}

export function ConversationPage() {
  const { id = "" } = useParams();
  const conversation = useConversation(id);
  const client = useQueryClient();
  const navigate = useNavigate();
  const retry = useAsk();
  const endRef = useRef<HTMLDivElement>(null);
  const count = conversation.data?.messages.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [count]);

  // When an Edit answer that this tab asked for arrives, go to its first change, highlighted
  // (architecture 7.3, step 4). It happens once per run, so returning to the conversation later
  // never navigates away by itself.
  useEffect(() => {
    for (const m of conversation.data?.messages ?? []) {
      if (m.role !== "assistant" || !m.runId || m.status === "running" || !editRunsToOpen.has(m.runId)) continue;
      editRunsToOpen.delete(m.runId);
      const first = m.edit?.changes[0];
      if (first) {
        void client.invalidateQueries({ queryKey: ["review"] });
        navigate(`${changeUrl(first)}&from=${encodeURIComponent(`/c/${id}`)}`);
        return;
      }
    }
  }, [conversation.data, client, id, navigate]);

  if (conversation.error) return <section className="page"><ErrorNote error={conversation.error} /><Link to="/">Home</Link></section>;
  if (!conversation.data) return <section className="page" aria-busy="true"><p className="muted">Loading conversation…</p></section>;
  const c = conversation.data;
  const busy = c.messages.some((m) => m.status === "running");
  const userTurn = (index: number) => [...c.messages.slice(0, index)].reverse().find((m) => m.role === "user");

  return (
    <section className="page conversation" aria-labelledby="conv-h">
      <p className="path"><Link to="/">Home</Link> / Conversation</p>
      <h1 id="conv-h">{c.title}</h1>
      <ol className="transcript">
        {c.messages.map((m, i) => (
          <li key={m.id} className={`turn ${m.role}${m.authority === "edit" ? " edit-turn" : ""}`}>
            {m.role === "user" ? <p className="question"><strong>{m.authority === "edit" ? "You asked Nexus to edit:" : "You asked:"}</strong> {m.text}</p> : null}
            {m.role === "assistant" && m.status === "running" ? <Running message={m} /> : null}
            {m.role === "assistant" && m.status === "complete" ? <AnswerCard message={m} conversationId={c.id} /> : null}
            {m.role === "assistant" && (m.status === "failed" || m.status === "cancelled") ? (
              <div className={m.status === "failed" ? "error" : "notice"} role={m.status === "failed" ? "alert" : "note"}>
                <p>{m.status === "cancelled" ? "Cancelled." : "This question could not be answered."} {m.error?.message}</p>
                <RetryButton message={m} edit={userTurn(i)?.authority === "edit"} disabled={busy || retry.isPending}
                  onRetry={() => {
                    const turn = userTurn(i);
                    retry.mutate({ question: turn?.text ?? "", conversationId: c.id, mode: turn?.authority ?? "ask" }, { onSuccess: () => void client.invalidateQueries({ queryKey: ["conversation", c.id] }) });
                  }} />
                {m.error?.code === "PROVIDER_AUTH" ? <> <Link to="/settings">Check the key in Settings</Link></> : null}
              </div>
            ) : null}
            {m.role === "assistant" && m.status !== "running" ? <EditCard message={m} conversationId={c.id} /> : null}
          </li>
        ))}
      </ol>
      <div ref={endRef} />
      <p className="muted">Nexus reads your last few questions here to understand a follow-up, then checks the workspace again for every answer. Ask never changes your files. Edit proposes changes that you accept or reject one at a time.</p>
      <Composer conversationId={c.id} busy={busy} />
    </section>
  );
}
