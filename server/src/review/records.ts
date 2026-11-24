// Pure record changes on issues.json. They are deterministic, so recovery can recompute them.
import { Issue, type ChangeRecord, type IssuesFile, type NoteLink, type RecordField } from "@nexus/schema";
import { sameValue } from "../util/json";

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

export const sameLink = (a: NoteLink, b: NoteLink) => a.notePath === b.notePath && a.headingSlug === b.headingSlug;
export const hasLink = (issue: Issue, link: NoteLink) => issue.noteLinks.some((l) => sameLink(l, link));

export function addIssue(file: IssuesFile, issue: Issue): IssuesFile {
  return { ...file, issues: [...file.issues, issue] };
}

export function removeIssue(file: IssuesFile, recordId: string): IssuesFile {
  return { ...file, issues: file.issues.filter((i) => i.id !== recordId) };
}

export function addLink(file: IssuesFile, recordId: string, link: NoteLink, at: string): IssuesFile {
  return { ...file, issues: file.issues.map((i) => (i.id === recordId ? { ...i, noteLinks: [...i.noteLinks, link], updatedAt: at, revision: i.revision + 1 } : i)) };
}

export function removeLink(file: IssuesFile, recordId: string, link: NoteLink, at: string): IssuesFile {
  return {
    ...file,
    issues: file.issues.map((i) => {
      if (i.id !== recordId) return i;
      const index = i.noteLinks.findIndex((l) => sameLink(l, link));
      if (index < 0) return i;
      return { ...i, noteLinks: i.noteLinks.filter((_, n) => n !== index), updatedAt: at, revision: i.revision + 1 };
    }),
  };
}

/** The fields a person can change on an issue a change created: if they differ, newer work exists. */
export function createdUnchanged(current: Issue, created: Issue): boolean {
  return (["title", "description", "status", "priority", "due", "noteLinks"] as const).every((f) => sameValue(current[f], created[f]));
}

/**
 * Apply one record change to the issues file, or return the reason it no longer applies
 * (used for the first apply, for recovery and for Retry, so all three agree).
 */
export function applyRecordChange(file: IssuesFile, change: ChangeRecord, at: string): { ok: true; file: IssuesFile } | { ok: false; why: string } {
  const issue = file.issues.find((i) => i.id === change.target.recordId);
  if (change.kind === "record.updateField") {
    if (!issue) return { ok: false, why: `${change.target.recordKey} no longer exists` };
    if (!sameValue(issue[change.target.field!], change.before)) return { ok: false, why: "the field no longer has the value this change expected" };
    if (!validFieldValue(issue, change.target.field!, change.after)) return { ok: false, why: "the new value is not valid" };
    return { ok: true, file: setField(file, issue.id, change.target.field!, change.after, at) };
  }
  if (change.kind === "record.create") {
    const created = Issue.parse(change.after);
    if (issue || file.issues.some((i) => i.key === created.key)) return { ok: false, why: `${created.key} already exists` };
    return { ok: true, file: addIssue(file, created) };
  }
  if (change.kind === "record.addLink") {
    const link = change.after as NoteLink;
    if (!issue) return { ok: false, why: `${change.target.recordKey} does not exist` };
    if (hasLink(issue, link)) return { ok: false, why: "the link is already there" };
    return { ok: true, file: addLink(file, issue.id, link, at) };
  }
  return { ok: false, why: "not a record change" };
}
