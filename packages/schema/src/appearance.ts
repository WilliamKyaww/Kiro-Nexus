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

/**
 * The stored preference from the text of `appearance.json`, or the default when there is no
 * text or it is not a valid preference (`null`, an array, wrong types, an unknown palette).
 * The service and Electron main both read the file through this, so they cannot disagree (R6-11).
 */
export function appearanceFromText(text: string | null | undefined): Appearance {
  if (!text) return { ...DEFAULT_APPEARANCE };
  try {
    const parsed = Appearance.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : { ...DEFAULT_APPEARANCE };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/**
 * A change to the preference: only the fields the user changed. The service merges it into the
 * stored value, so two sessions changing different fields both keep their choice (R6-12).
 */
export const AppearancePatch = z
  .strictObject({ mode: AppearanceMode.optional(), light: z.enum(LIGHT_PALETTES).optional(), dark: z.enum(DARK_PALETTES).optional() })
  .refine((p) => p.mode !== undefined || p.light !== undefined || p.dark !== undefined, { message: "Choose a mode or a palette." });
export type AppearancePatch = z.infer<typeof AppearancePatch>;

/**
 * The preference as the API serves it: the stored value and `revision`, which the service
 * raises with each saved change while it runs. It is not stored. A session applies a value only
 * when its revision is newer than the one it holds, so a late answer never brings back an older
 * choice (R6-12).
 */
export const AppearanceView = Appearance.extend({ revision: z.number().int().nonnegative() });
export type AppearanceView = z.infer<typeof AppearanceView>;

/** The theme rendered now: in Match system it is the system's, otherwise the chosen mode. */
export function effectiveTheme(a: Pick<Appearance, "mode">, systemDark: boolean): "light" | "dark" {
  return a.mode === "system" ? (systemDark ? "dark" : "light") : a.mode;
}
