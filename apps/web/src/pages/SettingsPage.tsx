import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ReminderSettings, WorkspaceView } from "@nexus/schema";
import { ApiError, api } from "../api";
import { ErrorNote } from "../components/ErrorNote";
import { notificationsKey, useNotifications } from "../notifications/notifications";

type Cap = "unknown" | "yes" | "no" | "error";
export interface ProviderView {
  id: string; name: string; baseUrl: string; model: string; receivingHost: string;
  hasKey: boolean; keyStorage: "os-protected" | "session" | null;
  capabilities: { toolCalling: Cap; structuredOutput: Cap; testedAt: string | null; detail: string | null; fixture: boolean };
}
export interface ProvidersResponse {
  selectedId: string | null;
  profiles: ProviderView[];
  templates: Array<{ id: string; label: string; name: string; baseUrl: string; model: string; signUpUrl: string }>;
  desktopKeys: boolean;
}

export const providersKey = ["providers"] as const;
export function useProviders() {
  return useQuery({ queryKey: providersKey, queryFn: () => api.get<ProvidersResponse>("/providers") });
}

const capLabel = (c: Cap) => ({ yes: "Yes", no: "No", error: "Could not check", unknown: "Not tested" })[c];
const storageLabel = (p: ProviderView) => !p.hasKey ? "No key" : p.keyStorage === "os-protected" ? "Key saved, protected by Windows" : "Key kept for this session only";

/** Store a key without it ever touching renderer storage: desktop → encrypted by Electron main; browser → service memory. */
async function storeKey(profileId: string, key: string): Promise<void> {
  if (window.nexusNative) await window.nexusNative.setProviderKey(profileId, key);
  else await api.put(`/providers/${encodeURIComponent(profileId)}/session-key`, { key });
}

export function SettingsPage() {
  const client = useQueryClient();
  const providers = useProviders();
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.get<WorkspaceView>("/workspace") });
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: providersKey }), client.invalidateQueries({ queryKey: ["ask", "status"] })]);
  const [message, setMessage] = useState<string | null>(null);

  const test = useMutation({
    mutationFn: (id: string) => api.post<{ profile: ProviderView }>(`/providers/${encodeURIComponent(id)}/test`),
    onSuccess: ({ profile }) => { setMessage(`Tested ${profile.name}: tool calling ${capLabel(profile.capabilities.toolCalling).toLowerCase()}, structured output ${capLabel(profile.capabilities.structuredOutput).toLowerCase()}.`); void refresh(); },
    onError: (e) => { setMessage(e instanceof ApiError ? `Test failed: ${e.message}` : "Test failed."); void refresh(); },
  });
  const select = useMutation({ mutationFn: (id: string) => api.post(`/providers/${encodeURIComponent(id)}/select`), onSuccess: () => void refresh() });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (window.nexusNative) await window.nexusNative.deleteProviderKey(id);
      await api.del(`/providers/${encodeURIComponent(id)}`);
    },
    onSuccess: () => { setMessage("Profile removed, and its key deleted."); void refresh(); },
  });

  return (
    <section className="page settings" aria-labelledby="settings-h">
      <h1 id="settings-h">Settings</h1>

      <h2>Workspace</h2>
      <p>{workspace.data?.workspace ? <>Open: <strong>{workspace.data.workspace.name}</strong> <span className="muted">({workspace.data.workspace.root})</span></> : "No workspace is open."} <Link to="/workspace">Change workspace</Link></p>

      <h2>AI provider</h2>
      <p>
        Ask sends short excerpts of the notes and issues it retrieves to the provider you choose, and nothing else.
        Notes and projects work without a provider. Free plans may use what you send for training, so use fictional
        data until you are happy with that.
      </p>
      <p className="muted" role="status" aria-live="polite">{message ?? ""}</p>
      {providers.error ? <ErrorNote error={providers.error} /> : null}
      <ul className="provider-list">
        {(providers.data?.profiles ?? []).map((p) => {
          const selected = providers.data?.selectedId === p.id;
          return (
            <li key={p.id} className={selected ? "provider selected" : "provider"} aria-label={`Provider ${p.name}`}>
              <div className="provider-head">
                <strong>{p.name}</strong> {selected ? <span className="chip">In use</span> : null}
                {p.capabilities.fixture ? <span className="chip fixture">Test double (fixture, not AI)</span> : null}
              </div>
              <p className="muted">Model <code>{p.model}</code> · sends excerpts to <strong>{p.receivingHost}</strong></p>
              <p>Tool calling: <strong>{capLabel(p.capabilities.toolCalling)}</strong> · Structured output: <strong>{capLabel(p.capabilities.structuredOutput)}</strong> · {storageLabel(p)}</p>
              {p.capabilities.detail ? <p className="muted">{p.capabilities.detail}</p> : null}
              <div className="row">
                {!selected ? <button type="button" onClick={() => select.mutate(p.id)}>Use this provider</button> : null}
                <button type="button" onClick={() => test.mutate(p.id)} disabled={test.isPending || !p.hasKey}>{test.isPending && test.variables === p.id ? "Testing…" : "Test"}</button>
                <KeyButton profile={p} onDone={() => { setMessage(`Key stored for ${p.name}.`); void refresh(); }} />
                <button type="button" onClick={() => remove.mutate(p.id)}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>
      {providers.isSuccess && providers.data.profiles.length === 0 ? <p className="muted">No provider yet. AI is off.</p> : null}
      {providers.data ? <AddProvider templates={providers.data.templates} onAdded={(text) => { setMessage(text); void refresh(); }} testAfter={(id) => test.mutate(id)} /> : null}

      <RemindersSettings />
    </section>
  );
}

/** B4 requirement 5.1: when ordinary reminders fire. Saved in the workspace (.nexus/reminders.json). */
function RemindersSettings() {
  const client = useQueryClient();
  const view = useNotifications();
  const [draft, setDraft] = useState<Partial<ReminderSettings> | null>(null);
  const save = useMutation({
    mutationFn: (patch: Partial<ReminderSettings>) => api.put<ReminderSettings>("/reminders/settings", patch),
    onSuccess: () => { setDraft(null); void client.invalidateQueries({ queryKey: notificationsKey }); },
  });
  const s = view.data?.settings;
  if (!s) return null;
  const value = { ...s, ...draft };
  const set = (patch: Partial<ReminderSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const native = view.data?.native ?? null;
  return (
    <section aria-labelledby="reminders-h" id="reminders">
      <h2 id="reminders-h">Reminders</h2>
      <p className="muted">Reminders are delivered only while Nexus is running, from accepted dates only. These settings belong to this workspace.</p>
      <form className="reminder-settings" aria-label="Reminder settings" onSubmit={(e) => { e.preventDefault(); if (draft) save.mutate(draft); }}>
        <label className="check"><input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Send reminders for due dates and events</label>
        <label>Time on an all-day due date
          <input type="time" value={value.allDayTime} onChange={(e) => set({ allDayTime: e.target.value })} required />
        </label>
        <label>Minutes before a timed due date or event
          <input type="number" min={0} max={10080} value={value.timedOffsetMinutes} onChange={(e) => set({ timedOffsetMinutes: Number(e.target.value) })} required />
        </label>
        {native ? (
          <label className="check"><input type="checkbox" checked={value.nativeNotifications} onChange={(e) => set({ nativeNotifications: e.target.checked })} disabled={!native.available} /> Also show desktop notifications{native.available ? "" : ` (unavailable: ${native.reason ?? "not supported"})`}</label>
        ) : null}
        <div className="row">
          <button type="submit" className="primary" disabled={!draft || save.isPending}>Save reminder settings</button>
          <span className="muted" role="status">{save.isSuccess && !draft ? "Saved." : draft ? "Unsaved changes" : ""}</span>
        </div>
        {save.error ? <ErrorNote error={save.error} /> : null}
      </form>
      <p><Link to="/notifications">Notifications and the test reminder</Link></p>
    </section>
  );
}

function KeyButton({ profile, onDone }: { profile: ProviderView; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const save = useMutation({ mutationFn: () => storeKey(profile.id, key), onSuccess: () => { setKey(""); setOpen(false); onDone(); } });
  if (!open) return <button type="button" onClick={() => setOpen(true)}>{profile.hasKey ? "Replace key" : "Add key"}</button>;
  return (
    <form className="inline-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} aria-label={`Key for ${profile.name}`}>
      <label>API key<input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} required /></label>
      <button type="submit" disabled={save.isPending}>Save key</button>
      <button type="button" className="link-button" onClick={() => { setKey(""); setOpen(false); }}>Cancel</button>
      {save.error ? <ErrorNote error={save.error} /> : null}
    </form>
  );
}

function AddProvider({ templates, onAdded, testAfter }: { templates: ProvidersResponse["templates"]; onAdded: (m: string) => void; testAfter: (id: string) => void }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const p = await api.post<ProviderView>("/providers", { name, baseUrl, model });
      if (key.trim()) await storeKey(p.id, key.trim());
      return p;
    },
    onSuccess: (p) => {
      const hadKey = !!key.trim();
      setName(""); setBaseUrl(""); setModel(""); setKey("");
      onAdded(`Added ${p.name}.${hadKey ? " Testing it now…" : " Add a key to use it."}`);
      if (hadKey) testAfter(p.id);
    },
  });
  const useTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setName(t.name); setBaseUrl(t.baseUrl); setModel(t.model);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };
  return (
    <form className="add-provider" onSubmit={submit} aria-label="Add a provider">
      <h3>Add an OpenAI-compatible provider</h3>
      <label>Start from
        <select defaultValue="" onChange={(e) => useTemplate(e.target.value)}>
          <option value="">Enter details yourself</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      {templates[0] ? <p className="muted">For the Groq free plan, create a key at <a href={templates[0].signUpUrl} target="_blank" rel="noreferrer noopener">console.groq.com/keys</a>. Nexus has not yet confirmed this route works end to end.</p> : null}
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label>Base URL<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" required /></label>
      <label>Model<input value={model} onChange={(e) => setModel(e.target.value)} required /></label>
      <label>API key<input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></label>
      <p className="muted">{window.nexusNative ? "The desktop app encrypts the key with Windows protection, outside your workspace." : "In the browser the key is kept for this session only and is never written to disk."}</p>
      <button type="submit" className="primary" disabled={add.isPending}>Add provider</button>
      {add.error ? <ErrorNote error={add.error} /> : null}
    </form>
  );
}
