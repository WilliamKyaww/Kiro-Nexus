// Slice extensions registered by main.ts.
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./app";
import { askRoutes, settleInterruptedRuns } from "./ask/routes";
import { installNotes, notesRoutes } from "./notes";
import { installProviders, providerRoutes } from "./providers";
import { installReview, reviewRoutes } from "./review";
import type { AppState } from "./state";

export function extraPlugins(state: AppState): Array<(app: FastifyInstance, ctx: RouteContext) => void> {
  return [reviewRoutes(state), notesRoutes(state), providerRoutes(state), askRoutes(state)];
}

/** Runs before the service listens or opens a workspace. Review recovery runs before search indexing. */
export async function extraStartup(state: AppState): Promise<void> {
  installReview(state);
  installNotes(state);
  await installProviders(state);
  state.onOpen.push(async (service) => { await settleInterruptedRuns(service); });
}
