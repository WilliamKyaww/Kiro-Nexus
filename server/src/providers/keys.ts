// Provider keys, held in service memory only (PRD-076). On desktop, Electron main
// keeps them encrypted with safeStorage and sends them over the private process port;
// in the browser they last for the session. Keys never leave this module except in the
// Authorization header of a request to the profile's own base URL.
import { redactSecrets, sanitiseDiagnostic } from "./sanitise.mjs";

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

  private known(): string[] { return [...this.keys.values()].map((k) => k.key); }

  /** Remove every known key, fragments of it and key-shaped strings (for log lines). */
  redact(text: string): string {
    return redactSecrets(text, this.known());
  }

  /** A provider diagnostic made safe to show, log or save: redacted, one line, capped. */
  sanitise(text: string | null, max = 400): string | null {
    if (text === null) return null;
    return sanitiseDiagnostic(text, { keys: this.known(), max }) || null;
  }
}
