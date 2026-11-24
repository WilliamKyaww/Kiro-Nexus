// Pure record-field changes on issues.json. They are deterministic, so recovery can recompute them.
import { Issue, type IssuesFile, type RecordField } from "@nexus/schema";

/** Stable JSON for value comparison (sorted keys). */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : v));
}

export const sameValue = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export function setField(file: IssuesFile, recordId: string, field: RecordField, value: unknown, at: string): IssuesFile {
  return {
    ...file,
    issues: file.issues.map((i) => (i.id === recordId ? { ...i, [field]: value, updatedAt: at, revision: i.revision + 1 } : i)),
  };
}

/** Check a proposed field value against the issue schema without changing anything. */
export function validFieldValue(issue: Issue, field: RecordField, value: unknown): boolean {
  return Issue.safeParse({ ...issue, [field]: value }).success;
}
