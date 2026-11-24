import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, notePathParam } from "../api";

interface Result { path: string; headingSlug: string | null; headingText: string | null; headingPath: string[]; snippet: string }

/** Section-level search (PRD-022). Results open the note at the matching heading. */
export function NoteSearch() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  const results = useQuery({
    queryKey: ["search", query],
    enabled: query.length > 0,
    queryFn: () => api.get<{ results: Result[] }>(`/search?q=${encodeURIComponent(query)}`),
  });
  return (
    <search className="note-search">
      <label>Search notes
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Words in a heading or text" />
      </label>
      {query ? (
        <div role="region" aria-label="Search results" aria-live="polite">
          {results.data?.results.length === 0 ? <p className="muted">No sections match “{query}”.</p> : null}
          <ul className="search-results">
            {(results.data?.results ?? []).map((r) => (
              <li key={`${r.path}#${r.headingSlug}`}>
                <Link to={notePathParam(r.path, r.headingSlug)}>
                  <span className="result-title">{r.headingPath.length ? r.headingPath.join(" › ") : r.path.replace(/\.md$/i, "")}</span>
                  <span className="result-path">{r.path}</span>
                </Link>
                {r.snippet ? <p className="result-snippet">{r.snippet}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </search>
  );
}
