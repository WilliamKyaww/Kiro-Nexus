// Slice extensions registered by main.ts.
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./app";
import { installNotes, notesRoutes } from "./notes";
import { installReview, reviewRoutes } from "./review";
import type { AppState } from "./state";

export function extraPlugins(state: AppState): Array<(app: FastifyInstance, ctx: RouteContext) => void> {
  return [reviewRoutes(state), notesRoutes(state)];
}

/** Runs before the service listens or opens a workspace. Review recovery runs before search indexing. */
export async function extraStartup(state: AppState): Promise<void> {
  installReview(state);
  installNotes(state);
}
