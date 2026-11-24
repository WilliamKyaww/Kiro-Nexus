import { useNavigate } from "react-router";
import { dismissToast, openPath, useToasts } from "./notifications";

/** In-app notifications (B4 requirement 4.1). Announced politely; keyboard reachable. */
export function Toasts() {
  const toasts = useToasts();
  const navigate = useNavigate();
  return (
    <section className="toasts" aria-label="New reminders" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === "test" ? " test" : ""}`} role="status" data-testid="reminder-toast">
          <p className="toast-title"><strong>{t.kind === "test" ? "Test reminder" : "Reminder"}</strong>{t.targetKey && t.kind === "issue" ? ` · ${t.targetKey}` : ""}</p>
          <p>{t.kind === "test" ? t.detail : <>{t.title}: {t.detail}</>}</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => { dismissToast(t.id); navigate(openPath(t)); }}>Open</button>
            <button type="button" onClick={() => dismissToast(t.id)}>Dismiss</button>
          </div>
        </div>
      ))}
    </section>
  );
}
