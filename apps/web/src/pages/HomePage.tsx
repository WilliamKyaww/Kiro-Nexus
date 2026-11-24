import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, notePathParam } from "../api";
import { extraHome } from "../homeSlots";
import { Composer } from "../ask/Composer";
import { useConversations } from "../ask/ask";

const SAMPLE_NOTE = "meetings/2026-11-24 kickoff.md";

/** With AI off, Home still offers a real next step. */
function StartActions() {
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => api.get<{ notes: string[] }>("/notes") });
  const list = notes.data?.notes ?? [];
  const first = list.includes(SAMPLE_NOTE) ? SAMPLE_NOTE : list[0];
  return (
    <div className="start-actions" aria-label="Get started">
      {first ? (
        <Link className="button primary big" to={notePathParam(first)}>
          {first === SAMPLE_NOTE ? "Open the kickoff meeting note" : `Open ${first.replace(/\.md$/i, "")}`}
        </Link>
      ) : (
        <Link className="button primary big" to="/notes">Create your first note</Link>
      )}
      <Link className="button big" to="/projects">Open projects</Link>
    </div>
  );
}

function RecentConversations() {
  const conversations = useConversations();
  const list = conversations.data?.conversations ?? [];
  return (
    <>
      <h2>Recent conversations</h2>
      {list.length === 0 ? <p className="muted">None yet.</p> : (
        <ul className="plain conversations">
          {list.slice(0, 8).map((c) => (
            <li key={c.id}><Link to={`/c/${c.id}`}>{c.title}</Link> <span className="muted">· {new Date(c.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></li>
          ))}
        </ul>
      )}
    </>
  );
}

export function HomePage() {
  return (
    <section className="page home" aria-labelledby="home-h">
      <h1 id="home-h">What do you need?</h1>
      <StartActions />
      <Composer />
      <RecentConversations />
      {extraHome.sections.map((Section, i) => <Section key={i} />)}
    </section>
  );
}
