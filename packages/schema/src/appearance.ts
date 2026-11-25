// Appearance preference (run 6, PRD-081, DEC-028): one per local profile, not per workspace.
import { z } from "zod";

export const LIGHT_PALETTES = ["porcelain", "linen", "mist"] as const;
export const DARK_PALETTES = ["graphite", "midnight", "plum"] as const;
export const AppearanceMode = z.enum(["light", "dark", "system"]);

export const Appearance = z.strictObject({
  schemaVersion: z.literal(1),
  mode: AppearanceMode,
  light: z.enum(LIGHT_PALETTES),
  dark: z.enum(DARK_PALETTES),
});
export type Appearance = z.infer<typeof Appearance>;
export type AppearanceMode = z.infer<typeof AppearanceMode>;

/** A fresh profile follows the system, with the approved light look and the graphite dark one. */
export const DEFAULT_APPEARANCE: Appearance = { schemaVersion: 1, mode: "system", light: "porcelain", dark: "graphite" };

/** The theme rendered now: in Match system it is the system's, otherwise the chosen mode. */
export function effectiveTheme(a: Pick<Appearance, "mode">, systemDark: boolean): "light" | "dark" {
  return a.mode === "system" ? (systemDark ? "dark" : "light") : a.mode;
}
