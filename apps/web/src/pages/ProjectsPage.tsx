import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { Project } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";

/** The project list. Each project opens its board (BoardPage). */
export function ProjectsPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: Project[] }>("/projects") });
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<Project>("/projects", { key: key.trim().toUpperCase(), name: name.trim() }),
    onSuccess: (p) => { void client.invalidateQueries({ queryKey: ["projects"] }); navigate(`/projects/${p.key}`); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <section className="page" aria-labelledby="projects-h">
      <h1 id="projects-h">Projects</h1>
      {projects.error ? <ErrorNote error={projects.error} /> : null}
      <ul className="cards-list">
        {(projects.data?.projects ?? []).map((p) => (
          <li key={p.id}><Link to={`/projects/${p.key}`}><strong>{p.key}</strong> {p.name}</Link></li>
        ))}
      </ul>
      {projects.isSuccess && projects.data.projects.length === 0 ? <p className="muted">No projects yet.</p> : null}
      <form className="inline-form" onSubmit={submit} aria-label="Create a project">
        <h2>New project</h2>
        <label>Key<input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="NEX" required pattern="[A-Z][A-Z0-9]{1,9}" title="2 to 10 capital letters or digits, starting with a letter" /></label>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nexus hackathon" required /></label>
        <button type="submit" disabled={create.isPending}>Create project</button>
        {create.error ? <ErrorNote error={create.error} /> : null}
      </form>
    </section>
  );
}
