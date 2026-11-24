// Slice extensions registered by main.ts.
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./app";
import { installReview, reviewRoutes } from "./review";
import type { AppState } from "./state";

export function extraPlugins(state: AppState): Array<(app: FastifyInstance, ctx: RouteContext) => void> {
  return [reviewRoutes(state)];
}

/** Runs before the service listens or opens a workspace. */
export async function extraStartup(state: AppState): Promise<void> {
  installReview(state);
}
