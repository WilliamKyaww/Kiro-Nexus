import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { WorkspaceView } from "@nexus/schema";
import { api } from "../api";
import { ErrorNote } from "../components/ErrorNote";

export function WorkspacePage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const [path, setPath] = useState("");
  const [samplePath, setSamplePath] = useState("");
  const done = () => { void client.invalidateQueries(); navigate("/notes"); };
  const open = useMutation({ mutationFn: (p: string) => api.post("/workspace/open", { path: p }), onSuccess: done });
  const sample = useMutation({ mutationFn: (p: string) => api.post("/workspace/sample", { targetPath: p }), onSuccess: done });
  const ws = workspace.data?.workspace;
  const browse = async () => {
    const picked = await window.nexusNative?.pickWorkspaceFolder();
    if (picked) setPath(picked);
  };

  return (
    <section className="page" aria-labelledby="ws-h">
      <h1 id="ws-h">Workspace</h1>
      {ws ? <p>Open now: <strong>{ws.name}</strong> <span className="muted">({ws.root})</span></p> : <p>No workspace is open. Choose a folder to keep your notes and projects in.</p>}
      {workspace.data?.openError ? <p className="error" role="alert">{workspace.data.openError.message}</p> : null}

      <form className="inline-form" onSubmit={(e: FormEvent) => { e.preventDefault(); open.mutate(path.trim()); }} aria-label="Open a folder">
        <h2>Open a folder</h2>
        <label>Folder path<input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\you\Documents\Nexus" required /></label>
        {window.nexusNative ? <button type="button" onClick={() => void browse()}>Browse…</button> : null}
        <button type="submit" disabled={open.isPending}>Open</button>
        <p className="muted">Nexus stores notes as .md files and project data in a .nexus folder inside it.</p>
        {open.error ? <ErrorNote error={open.error} /> : null}
      </form>

      <form className="inline-form" onSubmit={(e: FormEvent) => { e.preventDefault(); sample.mutate(samplePath.trim()); }} aria-label="Copy the sample workspace">
        <h2>Try the sample</h2>
        <label>New folder for a copy of the fictional sample<input value={samplePath} onChange={(e) => setSamplePath(e.target.value)} placeholder="C:\Users\you\Documents\Nexus sample" required /></label>
        <button type="submit" disabled={sample.isPending}>Copy and open</button>
        {sample.error ? <ErrorNote error={sample.error} /> : null}
      </form>

      {workspace.data?.recent.length ? (
        <>
          <h2>Recent</h2>
          <ul className="plain">
            {workspace.data.recent.map((r) => (
              <li key={r.path}><button type="button" className="link-button" onClick={() => open.mutate(r.path)}>{r.path}</button></li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
