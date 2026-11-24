import { Link } from "react-router";
import { citationHref, type AnswerItem, type Message } from "./ask";

function Sources({ item, message, conversationId }: { item: AnswerItem; message: Message; conversationId: string }) {
  if (!item.sources.length) return null;
  return (
    <span className="sources">
      {item.sources.map((h) => {
        const c = message.answer?.citations[h];
        if (!c) return null;
        return <Link key={h} className="citation" to={citationHref(c, conversationId, message.at)} title={`Open ${c.label}`}>{c.label}</Link>;
      })}
    </span>
  );
}

function Section({ title, items, message, conversationId, kind }: { title: string; items: AnswerItem[]; message: Message; conversationId: string; kind: string }) {
  if (!items.length) return null;
  return (
    <section className={`answer-section ${kind}`} aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            <span>{item.text}</span>
            {item.unsupported ? <span className="unsupported"> (not supported by a cited source)</span> : null}
            {item.qualifier ? <span className="qualifier"> {item.qualifier}</span> : null}
            <Sources item={item} message={message} conversationId={conversationId} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A validated answer: recorded facts, discrepancies and suggestions are kept apart. */
export function AnswerCard({ message, conversationId }: { message: Message; conversationId: string }) {
  const a = message.answer;
  if (!a) return null;
  return (
    <article className="answer" aria-label="Answer">
      {message.meta?.fixture ? <p className="fixture-banner">Answer from the local test double: a fixed, rule-based fixture, not AI.</p> : null}
      {a.insufficientEvidence ? (
        <p className="insufficient" role="note"><strong>Not enough evidence.</strong> {a.insufficientReason ?? "The workspace does not contain enough to answer this."}</p>
      ) : null}
      <Section title="Recorded facts" items={a.facts} message={message} conversationId={conversationId} kind="facts" />
      <Section title="Not confirmed by the evidence" items={a.unconfirmed ?? []} message={message} conversationId={conversationId} kind="unconfirmed" />
      <Section title="Discrepancies" items={a.discrepancies} message={message} conversationId={conversationId} kind="discrepancies" />
      <Section title="Suggestions (not established facts)" items={a.suggestions} message={message} conversationId={conversationId} kind="suggestions" />
      {a.removedCitations > 0 ? <p className="muted">Nexus removed {a.removedCitations} citation{a.removedCitations === 1 ? "" : "s"} that did not match any source it retrieved.</p> : null}
      {message.meta?.rejectedToolCalls.length ? <p className="muted">Nexus blocked an attempt to use {message.meta.rejectedToolCalls.join(", ")}: Ask is read-only.</p> : null}
      {message.meta ? (
        <p className="answer-meta muted">
          {message.meta.scopeNote} Answered by {message.meta.model} via {message.meta.receivingHost}
          {message.meta.mode === "retrieval-first" ? " (retrieval-first mode)" : ""}.
        </p>
      ) : null}
    </article>
  );
}
