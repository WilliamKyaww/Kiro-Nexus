// Unsaved note drafts, scoped to workspace and note, kept for the life of the
// browser tab (sessionStorage) so navigation, Back and review jumps never lose them.
// Drafts hold note text only; no keys or tokens are ever stored here.

export interface Draft {
  text: string;
  /** Revision of the note when this draft began (the editing base). */
  base: string;
  updatedAt: string;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

const PREFIX = "nexus.draft.v1:";
export const draftKey = (workspaceId: string, path: string) => `${PREFIX}${workspaceId}:${path}`;

export function createDraftStore(storage: DraftStorage | null) {
  const memory = new Map<string, Draft>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => { version += 1; for (const l of listeners) l(); };

  const read = (key: string): Draft | null => {
    const cached = memory.get(key);
    if (cached) return cached;
    try {
      const raw = storage?.getItem(key);
      if (!raw) return null;
      const d = JSON.parse(raw) as Draft;
      if (typeof d?.text !== "string" || typeof d?.base !== "string") return null;
      memory.set(key, d);
      return d;
    } catch {
      return null;
    }
  };
  const write = (key: string, d: Draft | null) => {
    if (d) memory.set(key, d); else memory.delete(key);
    try {
      if (d) storage?.setItem(key, JSON.stringify(d)); else storage?.removeItem(key);
    } catch { /* storage full or unavailable: the in-memory copy still protects the draft in this tab */ }
    changed();
  };

  return {
    get: (workspaceId: string, path: string) => read(draftKey(workspaceId, path)),
    set: (workspaceId: string, path: string, text: string, base: string) =>
      write(draftKey(workspaceId, path), { text, base, updatedAt: new Date().toISOString() }),
    clear: (workspaceId: string, path: string) => write(draftKey(workspaceId, path), null),
    /**
     * A save of `submitted` succeeded with `newRevision`. Clear the draft only if it
     * still holds exactly that text; otherwise keep the newer text, now based on the
     * saved revision. Returns the draft that remains, if any.
     */
    acknowledgeSave(workspaceId: string, path: string, submitted: string, newRevision: string): Draft | null {
      const key = draftKey(workspaceId, path);
      const current = read(key);
      if (!current || current.text === submitted) { write(key, null); return null; }
      const kept = { ...current, base: newRevision };
      write(key, kept);
      return kept;
    },
    paths(workspaceId: string): string[] {
      const prefix = `${PREFIX}${workspaceId}:`;
      const found = new Set<string>();
      for (const k of memory.keys()) if (k.startsWith(prefix)) found.add(k.slice(prefix.length));
      try {
        for (let i = 0; i < (storage?.length ?? 0); i++) {
          const k = storage?.key(i);
          if (k?.startsWith(prefix)) found.add(k.slice(prefix.length));
        }
      } catch { /* ignore */ }
      return [...found].sort();
    },
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    version: () => version,
  };
}

export type DraftStore = ReturnType<typeof createDraftStore>;

const sessionStore = (() => {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
})();
export const drafts: DraftStore = createDraftStore(sessionStore);
