// B4 reminders in the UI: the delivery list, in-app notifications and where a reminder leads.
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Delivery, NotificationsView } from "@nexus/schema";
import { api } from "../api";

export const notificationsKey = ["notifications"] as const;
export const useNotifications = () => useQuery({ queryKey: notificationsKey, queryFn: () => api.get<NotificationsView>("/notifications"), retry: false });

/** Every surface opens a reminder through this path, which checks its workspace and target first. */
export const openPath = (d: Pick<Delivery, "id" | "workspaceId">) => `/notifications/open?id=${encodeURIComponent(d.id)}&ws=${encodeURIComponent(d.workspaceId)}`;

/** Where a reminder's item is, once it is known to belong to the open workspace. */
export function targetPath(d: Delivery): string {
  if ((d.kind === "issue" || d.kind === "test") && d.targetKey && d.targetId) return `/issues/${encodeURIComponent(d.targetKey)}?id=${encodeURIComponent(d.targetId)}`;
  if (d.kind === "event" && d.targetKey) return `/calendar?month=${encodeURIComponent(d.targetKey)}&event=${encodeURIComponent(d.targetId ?? "")}`;
  return "/notifications";
}

export const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(",", "");

// --- In-app notifications shown by the shell (newest first, each for 12 seconds). ---
let toasts: Delivery[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
export function showToast(d: Delivery): void {
  if (toasts.some((t) => t.id === d.id)) return;
  toasts = [d, ...toasts].slice(0, 3);
  emit();
  setTimeout(() => dismissToast(d.id), 12_000);
}
export function dismissToast(id: string): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) { toasts = next; emit(); }
}
export const useToasts = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => toasts);
