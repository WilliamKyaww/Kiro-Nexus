// Slice extensions registered by main.ts. B5 (review) and B2 (watcher, search) add here.
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./app";
import type { AppState } from "./state";

export function extraPlugins(_state: AppState): Array<(app: FastifyInstance, ctx: RouteContext) => void> {
  return [];
}

export async function extraStartup(_state: AppState): Promise<void> {}
