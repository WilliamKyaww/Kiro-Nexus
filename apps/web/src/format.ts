import type { Due, IssuePriority, IssueStatus } from "@nexus/schema";

export const statusLabel: Record<IssueStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done" };
export const priorityLabel: Record<IssuePriority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatDue(due: Due | undefined): string {
  if (!due) return "None";
  if ("date" in due) return dateFormat.format(new Date(`${due.date}T00:00:00Z`));
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: due.timeZone }).format(new Date(due.dateTime));
}
