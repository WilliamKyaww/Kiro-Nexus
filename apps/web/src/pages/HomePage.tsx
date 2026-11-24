import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, notePathParam } from "../api";
import { extraHome } from "../homeSlots";

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

export function HomePage() {
  return (
    <section className="page home" aria-labelledby="home-h">
      <h1 id="home-h">What do you need?</h1>
      <StartActions />
      <form className="composer" onSubmit={(e) => e.preventDefault()} aria-describedby="ai-off">
        <label htmlFor="composer">Ask about your notes and projects</label>
        <textarea id="composer" rows={3} disabled placeholder="Asking questions needs an AI provider, which is not set up yet" />
        <div className="composer-row">
          <span className="chip" id="ai-off">AI is off</span>
          <span className="muted">Notes and projects work fully without it. Nothing here needs a key.</span>
        </div>
      </form>
      {extraHome.sections.map((Section, i) => <Section key={i} />)}
      <h2>Recent conversations</h2>
      <p className="muted">None yet.</p>
    </section>
  );
}
