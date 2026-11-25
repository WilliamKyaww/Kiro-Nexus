// Settings → Appearance (run 6, appearance requirement 2). Choices apply at once; there is no
// Save step. Each palette card previews its own tokens and marks the selected one in words.
import type { Appearance } from "@nexus/schema";
import { setAppearance, useAppearance } from "./appearance";
import { DARK, LIGHT, type PaletteInfo } from "./palettes";

const MODES: Array<{ id: Appearance["mode"]; label: string; hint: string }> = [
  { id: "light", label: "Light", hint: "Always the light theme." },
  { id: "dark", label: "Dark", hint: "Always the dark theme." },
  { id: "system", label: "Match system", hint: "Follows your computer's setting, and changes with it." },
];

export function AppearanceSettings() {
  const { appearance, theme, saveError } = useAppearance();
  return (
    <section aria-labelledby="appearance-h" id="appearance" className="appearance">
      <h2 id="appearance-h">Appearance</h2>
      <fieldset className="mode-choice">
        <legend>Mode</legend>
        {MODES.map((m) => (
          <label key={m.id} className="mode-option">
            <input type="radio" name="appearance-mode" value={m.id} checked={appearance.mode === m.id} onChange={() => setAppearance({ mode: m.id })} />
            <span><strong>{m.label}</strong> <span className="muted">{m.hint}</span></span>
          </label>
        ))}
      </fieldset>
      <p className="muted" role="status" data-testid="appearance-now">
        Showing the {theme} theme{appearance.mode === "system" ? ", as your computer is set to" : ""}. You can also use the Dark mode switch in the side bar on any page.
      </p>
      <PaletteGroup theme="light" title="Light palette" hint="Used whenever Nexus shows the light theme." items={LIGHT} value={appearance.light} onPick={(id) => setAppearance({ light: id })} />
      <PaletteGroup theme="dark" title="Dark palette" hint="Used whenever Nexus shows the dark theme." items={DARK} value={appearance.dark} onPick={(id) => setAppearance({ dark: id })} />
      {saveError ? <p className="error" role="alert">Your choice is shown, but Nexus could not save it for next time: {saveError}</p> : null}
    </section>
  );
}

function PaletteGroup<Id extends string>({ theme, title, hint, items, value, onPick }: { theme: "light" | "dark"; title: string; hint: string; items: Array<PaletteInfo<Id>>; value: Id; onPick: (id: Id) => void }) {
  return (
    <fieldset className="palette-group">
      <legend>{title}</legend>
      <p className="muted palette-hint">{hint}</p>
      <div className="palette-cards">
        {items.map((p) => {
          const selected = p.id === value;
          return (
            <label key={p.id} className="palette-card" data-selected={selected ? "true" : "false"}>
              <input type="radio" className="visually-hidden" name={`${theme}-palette`} value={p.id} checked={selected} onChange={() => onPick(p.id)} />
              <PalettePreview theme={theme} palette={p.id} />
              <span className="palette-name">{p.name}</span>
              <span className="palette-description">{p.description}</span>
              <span className="palette-selected" aria-hidden={!selected}>
                {selected ? (<><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>Selected</>) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A small Nexus screen drawn with the palette's own tokens: shell, panel, text, accent, selection and a pending marker. */
function PalettePreview({ theme, palette }: { theme: "light" | "dark"; palette: string }) {
  return (
    <span className="palette-preview" data-theme={theme} data-palette={palette} aria-hidden="true">
      <span className="pv-rail"><span className="pv-dot" /><span className="pv-nav pv-nav-on" /><span className="pv-nav" /><span className="pv-nav" /></span>
      <span className="pv-panel">
        <span className="pv-title">Kickoff</span>
        <span className="pv-text">Hein builds the <span className="pv-select">calendar</span> view</span>
        <span className="pv-row"><span className="pv-cite">NEX-1</span><span className="pv-pend">Pending</span></span>
        <span className="pv-button">Accept</span>
      </span>
    </span>
  );
}
