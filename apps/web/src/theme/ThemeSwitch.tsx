// The quick switch in the shell (run 6, appearance requirement 1). A real switch: its name is
// "Dark mode" and aria-checked says whether dark is shown. The words On or Off and the knob
// show the state without relying on colour. Focus stays on the button, since nothing remounts.
import { toggleTheme, useAppearance } from "./appearance";

export function ThemeSwitch() {
  const { theme } = useAppearance();
  const dark = theme === "dark";
  return (
    <button type="button" role="switch" aria-checked={dark} className="theme-switch" onClick={toggleTheme} title={dark ? "Switch to the light theme" : "Switch to the dark theme"}>
      <svg className="theme-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
        {dark
          ? <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
          : <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>}
      </svg>
      <span className="theme-switch-label">Dark mode</span>
      <span className="theme-switch-track" aria-hidden="true"><span className="theme-switch-knob" /></span>
      <span className="theme-switch-state" aria-hidden="true">{dark ? "On" : "Off"}</span>
    </button>
  );
}
