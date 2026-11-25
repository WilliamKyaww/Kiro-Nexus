// Slice extensions registered by main.ts.
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./app";
import { appearanceRoutes } from "./appearance";
import { askRoutes, settleInterruptedRuns } from "./ask/routes";
import { installNotes, notesRoutes } from "./notes";
import { installProviders, providerRoutes } from "./providers";
import { installReview, reviewRoutes } from "./review";
import { installReminders, reminderRoutes } from "./scheduler";
import type { AppState } from "./state";

export function extraPlugins(state: AppState): Array<(app: FastifyInstance, ctx: RouteContext) => void> {
  return [reviewRoutes(state), notesRoutes(state), providerRoutes(state), askRoutes(state), reminderRoutes(state), appearanceRoutes(state)];
}

/**
 * Runs before the service listens or opens a workspace. Review recovery runs before search
 * indexing, and before the reminder scheduler, which reads accepted values (B4).
 */
export async function extraStartup(state: AppState): Promise<void> {
  installReview(state);
  installNotes(state);
  await installProviders(state);
  state.onOpen.push(async (service) => { await settleInterruptedRuns(service); });
  installReminders(state);
}
