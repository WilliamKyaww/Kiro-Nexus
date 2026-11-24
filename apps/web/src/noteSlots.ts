// Extension points on the notes page (B2 search, B5 pending-change markers).
import type { ComponentType } from "react";

export const extraNotes: {
  sidebarTop: ComponentType[];
  aboveContent: ComponentType<{ path: string }>[];
} = { sidebarTop: [], aboveContent: [] };
