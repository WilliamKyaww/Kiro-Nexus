// Launch codes and session tokens (DEC-011). Nothing here is ever logged.
import { randomBytes, timingSafeEqual } from "node:crypto";

export const LAUNCH_CODE_TTL_MS = 2 * 60 * 1000;

function equalSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class SessionManager {
  private readonly launchCodes = new Map<string, number>();
  private readonly tokens = new Set<string>();

  constructor(
    readonly controlSecret: string = randomBytes(32).toString("base64url"),
    private readonly clock: () => number = Date.now,
  ) {}

  isControlSecret(candidate: string | undefined): boolean {
    return typeof candidate === "string" && equalSecret(candidate, this.controlSecret);
  }

  /** 128-bit, single use, short-lived. */
  mintLaunchCode(): string {
    this.prune();
    const code = randomBytes(16).toString("base64url");
    this.launchCodes.set(code, this.clock() + LAUNCH_CODE_TTL_MS);
    return code;
  }

  /** Burn the code and return a 256-bit session token, or null if unknown, used or expired. */
  exchange(code: string): string | null {
    const expires = this.launchCodes.get(code);
    this.launchCodes.delete(code);
    if (expires === undefined || expires < this.clock()) return null;
    const token = randomBytes(32).toString("base64url");
    this.tokens.add(token);
    return token;
  }

  isValidToken(token: string | undefined): boolean {
    return typeof token === "string" && token.length >= 40 && this.tokens.has(token);
  }

  private prune(): void {
    const t = this.clock();
    for (const [code, expires] of this.launchCodes) if (expires < t) this.launchCodes.delete(code);
  }
}

export function bearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const m = value?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/);
  return m?.[1];
}
