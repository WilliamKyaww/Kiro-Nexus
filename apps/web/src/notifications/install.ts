// Registers the B4 reminder surfaces with the shell.
import type { Delivery } from "@nexus/schema";
import { extraShell } from "../slices";
import { notificationsKey, showToast } from "./notifications";
import { Toasts } from "./Toasts";

extraShell.overlays.push(Toasts);
extraShell.eventHandlers.push((event, client) => {
  if (event.type === "notification" && event.delivery) {
    showToast(event.delivery as Delivery);
    void client.invalidateQueries({ queryKey: notificationsKey });
  }
  if (event.type === "notifications.seen") void client.invalidateQueries({ queryKey: notificationsKey });
  if (event.type === "workspace.changed") void client.invalidateQueries({ queryKey: notificationsKey });
});
