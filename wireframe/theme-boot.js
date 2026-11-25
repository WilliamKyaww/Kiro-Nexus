// Sets the theme before the first paint (run 6, DEC-028). The wireframe has no service, so its
// preference lives in this browser's localStorage; the app keeps it in the local profile instead.
// wireframe.js owns the switch and Settings, and reuses window.nexusAppearance.
(function () {
  var KEY = "nexus-wireframe-appearance";
  var LIGHT = ["porcelain", "linen", "mist"];
  var DARK = ["graphite", "midnight", "plum"];
  var DEFAULT = { mode: "system", light: "porcelain", dark: "graphite" };
  var html = document.documentElement;
  var query = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function read() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && ["light", "dark", "system"].indexOf(s.mode) >= 0 && LIGHT.indexOf(s.light) >= 0 && DARK.indexOf(s.dark) >= 0) {
        return { mode: s.mode, light: s.light, dark: s.dark };
      }
    } catch (e) { /* private mode or damaged value: use the default */ }
    return { mode: DEFAULT.mode, light: DEFAULT.light, dark: DEFAULT.dark };
  }
  function theme(pref) {
    return pref.mode === "dark" || (pref.mode === "system" && !!(query && query.matches)) ? "dark" : "light";
  }
  function apply(pref) {
    var t = theme(pref);
    html.setAttribute("data-theme", t);
    html.setAttribute("data-palette", t === "dark" ? pref.dark : pref.light);
    return t;
  }
  function save(pref) {
    try { localStorage.setItem(KEY, JSON.stringify(pref)); return true; } catch (e) { return false; }
  }

  apply(read());
  window.nexusAppearance = { KEY: KEY, LIGHT: LIGHT, DARK: DARK, query: query, read: read, theme: theme, apply: apply, save: save };
})();
