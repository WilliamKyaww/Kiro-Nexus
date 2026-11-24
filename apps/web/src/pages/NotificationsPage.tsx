import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router";
import type { Delivery, WorkspaceView } from "@nexus/schema";
import { ApiError, api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { notificationsKey, openPath, targetPath, useNotifications, when } from "../notifications/notifications";

function Item({ d }: { d: Delivery }) {
  return (
    <li className={`delivery ${d.status}`} data-testid={`delivery-${d.kind}`}>
      <Link to={openPath(d)}>{d.kind === "test" ? "Test reminder" : `${d.targetKey && d.kind === "issue" ? `${d.targetKey} ` : ""}${d.title}`}</Link>
      <span className="muted"> · {d.detail} · {d.status === "missed" ? `was due ${when(d.scheduledAt)}, while Nexus was closed` : `delivered ${when(d.deliveredAt ?? d.scheduledAt)}`}</span>
    </li>
  );
}

/** Notifications (B4): delivered and missed reminders, and the test reminder (PRD-043, PRD-044). */
export function NotificationsPage() {
  const client = useQueryClient();
  const view = useNotifications();
  const test = useMutation({
    mutationFn: () => api.post<{ delivery: Delivery }>("/reminders/test"),
    onSuccess: () => void client.invalidateQueries({ queryKey: notificationsKey }),
  });
  const seen = useMutation({ mutationFn: (upTo: string) => api.post("/notifications/seen", { upTo }) });
  const newest = view.data?.deliveries.find((d) => d.status !== "missed")?.deliveredAt ?? view.data?.deliveries.find((d) => d.status !== "missed")?.scheduledAt ?? null;
  // Opening this list counts as seeing what it shows, in every tab.
  useEffect(() => { if (newest && (view.data?.unseen ?? 0) > 0) seen.mutate(newest); }, [newest, view.data?.unseen]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = view.data;
  const others = (v?.deliveries ?? []).filter((d) => !v?.away.some((a) => a.id === d.id));
  return (
    <section className="page notifications" aria-labelledby="notifications-h">
      <h1 id="notifications-h">Notifications</h1>
      <p className="muted">
        Nexus delivers reminders only while it is running. Reminders that come due while it is closed are listed
        once, under “While you were away”, the next time it opens. A date that is still awaiting review never
        triggers a reminder. <Link to="/settings#reminders">Reminder settings</Link>
      </p>
      {v?.native && !v.native.available ? <p className="notice" role="note">Desktop notifications are off: {v.native.reason ?? "they are not available."} Reminders still appear here and inside Nexus.</p> : null}
      {v && !v.settings.enabled ? <p className="notice" role="note">Reminders are turned off in Settings. The test reminder still works.</p> : null}
      <div className="row">
        <button type="button" onClick={() => test.mutate()} disabled={test.isPending}>Send test reminder</button>
        {test.isSuccess ? <span className="muted" role="status">Sent a test reminder.</span> : null}
      </div>
      {view.error ? <ErrorNote error={view.error} /> : null}
      {v?.away.length ? (
        <section className="away" aria-labelledby="away-h">
          <h2 id="away-h">While you were away</h2>
          <p className="muted">These came due while Nexus was closed. They are shown here once, for this session.</p>
          <ul className="deliveries">{v.away.map((d) => <Item key={d.id} d={d} />)}</ul>
        </section>
      ) : null}
      <h2>History</h2>
      {v && others.length === 0 ? <p className="muted">No reminders yet.</p> : null}
      <ul className="deliveries">{others.map((d) => <Item key={d.id} d={d} />)}</ul>
    </section>
  );
}

/**
 * Where every reminder surface leads (in-app, list, native): it checks that the reminder
 * belongs to the open workspace and still exists, then opens its item (B4 requirement 4.3 to 4.5).
 */
export function OpenNotificationPage() {
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const ws = params.get("ws");
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const found = useQuery({
    queryKey: ["notification", id], enabled: !!id && !!workspace.data,
    queryFn: () => api.get<{ delivery: Delivery; workspaceId: string }>(`/notifications/${encodeURIComponent(id)}`), retry: false,
  });
  const openId = workspace.data?.workspace?.workspaceId ?? null;
  if (ws && openId && ws !== openId) {
    return <section className="page"><h1>Reminder from another workspace</h1><p role="alert">This reminder belongs to a workspace that is not open now. Open that workspace from the <Link to="/workspace">Workspace page</Link> to see it.</p></section>;
  }
  if (found.error) {
    const gone = found.error instanceof ApiError && found.error.code === "NOT_FOUND";
    return <section className="page"><h1>Reminder not found</h1>{gone ? <p role="alert">This reminder is no longer in this workspace&apos;s history.</p> : <ErrorNote error={found.error} />}<Link to="/notifications">All notifications</Link></section>;
  }
  if (!found.data) return <section className="page" aria-busy="true"><p className="muted">Opening the reminder…</p></section>;
  return <Navigate to={targetPath(found.data.delivery)} replace />;
}
