// The appearance preference: the single source of truth for mode and palettes in the app
// (run 6, PRD-081, DEC-028). It sets data-theme and data-palette on <html>; every colour is a
// token keyed on that pair. Nothing in the React tree remounts when it changes, so drafts,
// the conversation and the review position stay as they are.
import { useSyncExternalStore } from "react";
import { Appearance, DEFAULT_APPEARANCE, effectiveTheme, type AppearanceMode } from "@nexus/schema";
import { api } from "../api";

export interface AppearanceSnapshot {
  appearance: Appearance;
  /** The theme shown now. */
  theme: "light" | "dark";
  systemDark: boolean;
  /** Set when the last change could not be saved to the profile. */
  saveError: string | null;
}

const html = document.documentElement;
const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

/** What the service filled into <html> for the first paint, or the default. */
function initial(): Appearance {
  const parsed = Appearance.safeParse({
    schemaVersion: 1,
    mode: html.getAttribute("data-mode") ?? DEFAULT_APPEARANCE.mode,
    light: html.getAttribute("data-light") ?? DEFAULT_APPEARANCE.light,
    dark: html.getAttribute("data-dark") ?? DEFAULT_APPEARANCE.dark,
  });
  return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
}

let appearance = initial();
let saveError: string | null = null;
let snapshot = build();
const listeners = new Set<() => void>();

function build(): AppearanceSnapshot {
  const systemDark = media?.matches ?? false;
  return { appearance, theme: effectiveTheme(appearance, systemDark), systemDark, saveError };
}

function apply(): void {
  snapshot = build();
  html.setAttribute("data-mode", appearance.mode);
  html.setAttribute("data-light", appearance.light);
  html.setAttribute("data-dark", appearance.dark);
  html.setAttribute("data-theme", snapshot.theme);
  html.setAttribute("data-palette", snapshot.theme === "dark" ? appearance.dark : appearance.light);
  for (const fn of listeners) fn();
}

// While Match system is chosen, a change of the system setting applies at once.
media?.addEventListener("change", () => apply());
apply();

export function getAppearance(): AppearanceSnapshot { return snapshot; }

export function useAppearance(): AppearanceSnapshot {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getAppearance);
}

let saving = Promise.resolve();
/** Change the preference: it applies at once and is saved to the profile in order. */
export function setAppearance(patch: Partial<Pick<Appearance, "mode" | "light" | "dark">>): void {
  appearance = { ...appearance, ...patch };
  saveError = null;
  apply();
  const value = appearance;
  saving = saving.then(() => api.put<{ appearance: Appearance }>("/appearance", value).then(() => undefined, (e: unknown) => {
    saveError = e instanceof Error ? e.message : "The service did not answer.";
    apply();
  }));
}

/** The quick switch: the opposite of the theme shown now, chosen explicitly (also from Match system). */
export function toggleTheme(): void {
  setAppearance({ mode: (snapshot.theme === "dark" ? "light" : "dark") satisfies AppearanceMode });
}

/** Another tab or window changed the preference; take it without saving it again. */
export function receiveAppearance(value: unknown): void {
  const parsed = Appearance.safeParse(value);
  if (!parsed.success) return;
  appearance = parsed.data;
  apply();
}

/** Read the stored preference once a session exists (the dev server's page has no attributes). */
export async function loadAppearance(): Promise<void> {
  try {
    const r = await api.get<{ appearance: Appearance }>("/appearance");
    receiveAppearance(r.appearance);
  } catch {
    /* the first paint's value stays */
  }
}
