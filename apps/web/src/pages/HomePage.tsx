import { Link } from "react-router";
import { extraHome } from "../homeSlots";

export function HomePage() {
  return (
    <section className="page home" aria-labelledby="home-h">
      <h1 id="home-h">What do you need?</h1>
      <form className="composer" onSubmit={(e) => e.preventDefault()} aria-describedby="ai-off">
        <label htmlFor="composer">Message</label>
        <textarea id="composer" rows={3} disabled placeholder="Ask about your notes and projects (available when AI is set up)" />
        <div className="composer-row">
          <span className="chip" id="ai-off">AI is off</span>
          <span className="muted">Provider setup arrives in slice C. Nothing here needs a key.</span>
        </div>
      </form>
      <p>Start with <Link to="/notes">Notes</Link> or <Link to="/projects">Projects</Link>. Both work fully without AI.</p>
      {extraHome.sections.map((Section, i) => <Section key={i} />)}
      <h2>Recent conversations</h2>
      <p className="muted">None yet.</p>
    </section>
  );
}
