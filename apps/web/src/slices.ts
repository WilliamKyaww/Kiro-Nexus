// Extension points so later slices (B5 review bar, B2 watcher) plug into the shell.
import type { ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "./api";

export const extraShell: {
  overlays: ComponentType[];
  eventHandlers: Array<(event: ServerEvent, client: QueryClient) => void>;
} = { overlays: [], eventHandlers: [] };
