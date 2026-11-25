// Sets the theme before the first paint (run 6, PRD-081). The service fills the stored
// preference into <html> (data-mode, data-light, data-dark); this works out the theme to show
// now. It is an external file because the CSP allows no inline script.
(function () {
  var html = document.documentElement;
  var mode = html.getAttribute("data-mode") || "system";
  var light = html.getAttribute("data-light") || "porcelain";
  var dark = html.getAttribute("data-dark") || "graphite";
  var systemDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var theme = mode === "dark" || (mode === "system" && systemDark) ? "dark" : "light";
  html.setAttribute("data-theme", theme);
  html.setAttribute("data-palette", theme === "dark" ? dark : light);
})();
