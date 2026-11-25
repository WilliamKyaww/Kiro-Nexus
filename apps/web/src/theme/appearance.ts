// The appearance preference: the single source of truth for mode and palettes in the app
// (run 6, PRD-081, DEC-028). It sets data-theme and data-palette on <html>; every colour is a
// token keyed on that pair. Nothing in the React tree remounts when it changes, so drafts,
// the conversation and the review position stay as they are.
//
// Saving (R6-12): each change sends only the fields the user changed, and the service merges it
// into the profile's preference. What the tab shows is the service's newest value (by revision)
// with this tab's unanswered changes laid over it, in order. Another session's change therefore
// shows at once, and neither an older value nor a late answer brings back a stale choice.
import { useSyncExternalStore } from "react";
import { Appearance, AppearanceView, DEFAULT_APPEARANCE, effectiveTheme, type AppearanceMode, type AppearancePatch } from "@nexus/schema";
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

/** The profile's preference as the service last reported it, and its revision (-1: only the first paint's). */
let confirmed = initial();
let confirmedRevision = -1;
/** This tab's changes that the service has not answered yet, oldest first. */
const unanswered: AppearancePatch[] = [];
/** What the tab shows: the confirmed value with the unanswered changes laid over it. */
let appearance = confirmed;
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

function show(): void {
  appearance = unanswered.reduce<Appearance>((shown, change) => ({ ...shown, ...change }), confirmed);
  apply();
}

/** Takes a value from the service if it is newer than the one held. */
function confirm(value: unknown): boolean {
  const parsed = AppearanceView.safeParse(value);
  if (!parsed.success || parsed.data.revision <= confirmedRevision) return false;
  const { revision, ...stored } = parsed.data;
  confirmed = stored;
  confirmedRevision = revision;
  return true;
}

let saving = Promise.resolve();
/** Change the preference: it applies at once, and only the changed fields are saved, in order. */
export function setAppearance(patch: Partial<Pick<Appearance, "mode" | "light" | "dark">>): void {
  const change: AppearancePatch = {};
  if (patch.mode !== undefined) change.mode = patch.mode;
  if (patch.light !== undefined) change.light = patch.light;
  if (patch.dark !== undefined) change.dark = patch.dark;
  if (Object.keys(change).length === 0) return;
  unanswered.push(change);
  saveError = null;
  show();
  const answered = () => { unanswered.splice(unanswered.indexOf(change), 1); };
  saving = saving.then(() => api.patch<{ appearance: unknown }>("/appearance", change).then((r) => {
    answered();
    confirm(r.appearance);
    show();
  }, (e: unknown) => {
    // The choice stays on screen, unsaved, until a newer value comes from the service.
    answered();
    confirmed = { ...confirmed, ...change };
    saveError = e instanceof Error ? e.message : "The service did not answer.";
    show();
  }));
}

/** The quick switch: the opposite of the theme shown now, chosen explicitly (also from Match system). */
export function toggleTheme(): void {
  setAppearance({ mode: (snapshot.theme === "dark" ? "light" : "dark") satisfies AppearanceMode });
}

/**
 * The service published the profile's preference (`appearance.changed`), after a change from
 * this or another tab or window. It is taken without saving it again, and only if it is newer.
 */
export function receiveAppearance(value: unknown): void {
  if (confirm(value)) show();
}

/** Read the stored preference once a session exists (the dev server's page has no attributes). */
export async function loadAppearance(): Promise<void> {
  try {
    const r = await api.get<{ appearance: unknown }>("/appearance");
    receiveAppearance(r.appearance);
  } catch {
    /* the first paint's value stays */
  }
}
