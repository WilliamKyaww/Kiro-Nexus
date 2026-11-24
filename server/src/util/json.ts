/** Stable JSON for value comparison (sorted object keys). */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : v)) ?? "undefined";
}

export const sameValue = (a: unknown, b: unknown) => canonical(a) === canonical(b);
