import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import type { WorkspaceView } from "@nexus/schema";
import { api, onSessionChange, subscribeEvents, type SessionState } from "./api";
import { HomePage } from "./pages/HomePage";
import { NotesPage } from "./pages/NotesPage";
import { ProjectsPage, ProjectPage } from "./pages/ProjectsPage";
import { IssuePage } from "./pages/IssuePage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { extraShell } from "./slices";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (count, error) => count < 1 && !(error as { status?: number }).status, refetchOnWindowFocus: false } },
});

export function App({ initialSession }: { initialSession: SessionState }) {
  const [session, setSession] = useState(initialSession);
  useEffect(() => onSessionChange(setSession), []);
  if (session.status !== "ready") return <LaunchScreen reason={session.reason} />;
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function LaunchScreen({ reason }: { reason: "fresh" | "expired" | "ended" }) {
  const message = {
    fresh: "This tab has no Nexus session yet.",
    expired: "This launch link has expired or was already used.",
    ended: "The Nexus service was restarted or closed, so this session has ended.",
  }[reason];
  return (
    <main className="launch" id="main">
      <h1>Open Nexus from its launcher</h1>
      <p>{message}</p>
      <p>To start a new session, run <code>npm run open</code> in the Nexus folder, or restart the desktop app.</p>
      <p className="muted">Nexus only accepts sessions started on this computer, so other websites cannot read your workspace.</p>
    </main>
  );
}

const sections = [
  { to: "/", label: "Home", end: true },
  { to: "/notes", label: "Notes" },
  { to: "/projects", label: "Projects" },
  { to: "/calendar", label: "Calendar" },
  { to: "/notifications", label: "Notifications" },
  { to: "/settings", label: "Settings" },
];

function useLiveUpdates(): boolean {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => subscribeEvents((event) => {
    if (event.type === "workspace.changed") { void client.invalidateQueries(); return; }
    if (event.type === "file.changed" && typeof event.path === "string") {
      if (event.path.startsWith(".nexus/")) {
        void client.invalidateQueries({ queryKey: ["issues"] });
        void client.invalidateQueries({ queryKey: ["issue"] });
        void client.invalidateQueries({ queryKey: ["projects"] });
        void client.invalidateQueries({ queryKey: ["note"] });
      } else {
        void client.invalidateQueries({ queryKey: ["notes"] });
        void client.invalidateQueries({ queryKey: ["note", event.path] });
        void client.invalidateQueries({ queryKey: ["search"] });
      }
      void client.invalidateQueries({ queryKey: ["review"] }); // pending markers follow the new content
    }
    for (const fn of extraShell.eventHandlers) fn(event, client);
  }, setConnected), [client]);
  return connected;
}

function Shell() {
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const connected = useLiveUpdates();
  const location = useLocation();
  const ws = workspace.data?.workspace;
  const needsWorkspace = workspace.isSuccess && !ws && location.pathname !== "/workspace";

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        <nav className="rail" aria-label="Sections">
          <p className="brand">Nexus</p>
          <ul>
            {sections.map((s) => (
              <li key={s.to}><NavLink to={s.to} end={s.end}>{s.label}</NavLink></li>
            ))}
          </ul>
          <div className="rail-footer">
            <NavLink to="/workspace" className="workspace-link">
              <span className="muted">Workspace</span>
              <strong>{ws ? ws.name : "None open"}</strong>
            </NavLink>
            <p className={connected ? "live ok" : "live"} role="status">{connected ? "Live updates on" : "Connecting…"}</p>
          </div>
        </nav>
        <main id="main" tabIndex={-1}>
          {needsWorkspace ? <Navigate to="/workspace" replace /> : (
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:key" element={<ProjectPage />} />
              <Route path="/issues/:key" element={<IssuePage />} />
              <Route path="/calendar" element={<PlaceholderPage title="Calendar" body="The calendar arrives in slice B3, which Hein owns. Due dates you set on issues are already stored for it." />} />
              <Route path="/notifications" element={<PlaceholderPage title="Notifications" body="Reminders arrive in slice B4. A due date awaiting review never triggers a reminder." />} />
              <Route path="/settings" element={<PlaceholderPage title="Settings" body="AI provider profiles arrive in slice C. Notes and projects never need a key." />} />
              <Route path="*" element={<PlaceholderPage title="Not found" body="This page does not exist." />} />
            </Routes>
          )}
        </main>
      </div>
      {extraShell.overlays.map((Overlay, i) => <Overlay key={i} />)}
    </>
  );
}
