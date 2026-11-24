import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import type { Issue, IssueView, Project } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { formatDue, priorityLabel, statusLabel } from "../format";

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

export function ProjectPage() {
  const { key = "" } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: Project[] }>("/projects") });
  const project = projects.data?.projects.find((p) => p.key === key);
  const issues = useQuery({
    queryKey: ["issues", project?.id],
    enabled: !!project,
    queryFn: () => api.get<{ issues: Issue[] }>(`/issues?projectId=${encodeURIComponent(project!.id)}`),
  });
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<IssueView>("/issues", { projectId: project!.id, title: title.trim() }),
    onSuccess: (issue) => { void client.invalidateQueries({ queryKey: ["issues"] }); navigate(`/issues/${issue.key}`); },
  });
  if (projects.isSuccess && !project) return <section className="page"><h1>Project not found</h1><Link to="/projects">All projects</Link></section>;
  return (
    <section className="page" aria-labelledby="project-h">
      <p className="path"><Link to="/projects">Projects</Link> / {key}</p>
      <h1 id="project-h">{project ? `${project.key} ${project.name}` : key}</h1>
      <p className="muted">A simple list for now. Hein's board view (slice B3) will replace it.</p>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} aria-label="Create an issue">
        <label>New issue<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Write the judge instructions" required /></label>
        <button type="submit" disabled={create.isPending || !project}>Create issue</button>
        {create.error ? <ErrorNote error={create.error} /> : null}
      </form>
      <table className="issues">
        <caption className="visually-hidden">Issues in {key}</caption>
        <thead><tr><th scope="col">Key</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Due</th></tr></thead>
        <tbody>
          {(issues.data?.issues ?? []).map((i) => (
            <tr key={i.id}>
              <td><Link to={`/issues/${i.key}`}>{i.key}</Link></td>
              <td>{i.title}</td>
              <td>{statusLabel[i.status]}</td>
              <td>{priorityLabel[i.priority]}</td>
              <td>{formatDue(i.due)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {issues.isSuccess && issues.data.issues.length === 0 ? <p className="muted">No issues yet.</p> : null}
    </section>
  );
}
