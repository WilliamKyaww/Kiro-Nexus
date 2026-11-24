import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ChangeView } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { changeUrl, setReviewUi } from "./review";

/** Fixed, clearly labelled operations that exercise the real review journal before an LLM does. */
export function DemoSection() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const run = useMutation({
    mutationFn: () => api.post<{ runId: string | null; changes: ChangeView[]; duplicates: string[] }>("/review/demo"),
    onSuccess: async (result) => {
      await client.invalidateQueries();
      setReviewUi({ message: result.runId ? "Applied 2 demo changes to the real files. Review each one." : "The demo changes were already applied in this workspace.", feedbackFor: null });
      const first = result.changes.find((c) => c.state === "pending" || c.state === "conflicted");
      if (first) navigate(changeUrl(first));
    },
  });
  return (
    <section className="demo" aria-labelledby="demo-h">
      <h2 id="demo-h">Try the review flow</h2>
      <p>
        These are <strong>fixed demo operations, not AI</strong>. They tick an item in the kickoff note and move <code>NEX-1</code>'s
        due date, writing both to the real files. You can then accept or reject each change on its own page.
      </p>
      <button type="button" onClick={() => run.mutate()} disabled={run.isPending}>Apply demo changes (fixed, not AI)</button>
      {run.error ? <ErrorNote error={run.error} /> : null}
    </section>
  );
}
