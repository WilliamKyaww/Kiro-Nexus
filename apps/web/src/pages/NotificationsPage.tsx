import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router";
import type { DamagedLogDetails, Delivery, ReminderProblem, WorkspaceView } from "@nexus/schema";
import { ApiError, api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { notificationsKey, openPath, targetPath, useNotifications, when } from "../notifications/notifications";

/** The delivery log is damaged (R5-5): say which file, what Nexus did not do, and the two ways out. */
function DamagedLog({ details }: { details: DamagedLogDetails }) {
  const client = useQueryClient();
  const replace = useMutation({
    mutationFn: () => api.post<{ keptAs: string }>("/reminders/delivery-log/replace"),
    onSuccess: () => void client.invalidateQueries({ queryKey: notificationsKey }),
  });
  return (
    <section className="notice" role="alert" aria-labelledby="damaged-h" data-testid="damaged-log">
      <h2 id="damaged-h">Reminders are paused</h2>
      <p>
        Nexus cannot read its reminder delivery log, <code>{details.file}</code>, so it is not delivering reminders.
        Nexus has not changed the file.
      </p>
      <p>
        Repair the file and reload this page, or start a new delivery log. Nexus keeps a copy of the damaged file
        beside it. Reminders that came due before now are not delivered or listed again.
      </p>
      <div className="row">
        <button type="button" onClick={() => replace.mutate()} disabled={replace.isPending}>Start a new delivery log</button>
      </div>
      {replace.error ? <ErrorNote error={replace.error} /> : null}
    </section>
  );
}

/** Records the scheduler skipped (R5-4), each named with its file. The other reminders still work. */
function Problems({ problems }: { problems: ReminderProblem[] }) {
  return (
    <section className="notice" aria-labelledby="problems-h" data-testid="reminder-problems">
      <h2 id="problems-h">Some items have no reminder</h2>
      <p className="muted">Nexus skipped these records. Other reminders are not affected. Correct the record, and Nexus picks it up at its next check.</p>
      <ul>
        {problems.map((p) => <li key={`${p.file}:${p.record ?? ""}`}><code>{p.file}</code>{p.record ? <>, <code>{p.record}</code></> : null}: {p.message}</li>)}
      </ul>
    </section>
  );
}

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
  const details = view.error instanceof ApiError ? (view.error.details as Partial<DamagedLogDetails> | undefined) : undefined;
  const damaged = details?.recovery === "replace-delivery-log" && details.file ? (details as DamagedLogDetails) : null;
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
      {damaged ? <DamagedLog details={damaged} /> : null}
      <div className="row">
        <button type="button" onClick={() => test.mutate()} disabled={test.isPending || !!damaged}>Send test reminder</button>
        {test.isSuccess ? <span className="muted" role="status">Sent a test reminder.</span> : null}
      </div>
      {test.error && !damaged ? <ErrorNote error={test.error} /> : null}
      {view.error && !damaged ? <ErrorNote error={view.error} /> : null}
      {v?.problems?.length ? <Problems problems={v.problems} /> : null}
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
