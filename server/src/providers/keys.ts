// Provider keys, held in service memory only (PRD-076). On desktop, Electron main
// keeps them encrypted with safeStorage and sends them over the private process port;
// in the browser they last for the session. Keys never leave this module except in the
// Authorization header of a request to the profile's own base URL.
export type KeyStorage = "os-protected" | "session";

export class KeyStore {
  private readonly keys = new Map<string, { key: string; storage: KeyStorage }>();

  set(profileId: string, key: string, storage: KeyStorage): void {
    const clean = key.trim();
    if (!clean || clean.length > 500 || /\s/.test(clean)) throw new Error("That does not look like an API key.");
    this.keys.set(profileId, { key: clean, storage });
  }

  delete(profileId: string): void { this.keys.delete(profileId); }
  has(profileId: string): boolean { return this.keys.has(profileId); }
  storage(profileId: string): KeyStorage | null { return this.keys.get(profileId)?.storage ?? null; }
  /** Only the provider adapter calls this. */
  reveal(profileId: string): string | null { return this.keys.get(profileId)?.key ?? null; }

  /** Remove every known key from text before it is logged or returned. */
  redact(text: string): string {
    let out = text;
    for (const { key } of this.keys.values()) if (key.length >= 6) out = out.split(key).join("[redacted key]");
    return out;
  }
}
