// Pure record-field changes on issues.json. They are deterministic, so recovery can recompute them.
import { Issue, type IssuesFile, type RecordField } from "@nexus/schema";

export { canonical, sameValue } from "../util/json";

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
