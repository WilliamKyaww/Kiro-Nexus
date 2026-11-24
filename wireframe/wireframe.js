// Wireframe behaviour only: fictional data, fixed demo changes, no persistence.
const changes = [
  { id: "chg-note", view: "note", label: "Note: Kickoff › Actions, tick 'Hein builds the calendar view'",
    apply: (el) => { el.querySelector(".check").dataset.checked = "true"; },
    revert: (el) => { el.querySelector(".check").dataset.checked = "false"; } },
  { id: "chg-issue", view: "issue", label: "NEX-1 due date, 5 Dec 2026 to 3 Dec 2026",
    apply: (el) => { el.querySelector(".value").textContent = "3 Dec 2026"; },
    revert: (el) => { el.querySelector(".value").textContent = "5 Dec 2026"; } },
];
let index = 0;
const bar = document.querySelector(".review-bar");
const status = document.querySelector(".review-status");
const feedback = document.querySelector(".feedback");
const target = (c) => document.querySelector(`[data-target="${c.id}"]`);

function show(view, anchor) {
  document.querySelectorAll("[data-view]").forEach((s) => { s.hidden = s.dataset.view !== view; });
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const focusEl = anchor ? document.getElementById(anchor) : document.getElementById("main");
  if (focusEl) { focusEl.focus(); focusEl.scrollIntoView({ block: "center" }); }
}

function route() {
  const view = (location.hash.replace("#/", "") || "home").split("?")[0];
  show(view);
}

function focusChange() {
  const c = changes[index];
  if (location.hash !== `#/${c.view}`) history.replaceState(null, "", `#/${c.view}`);
  show(c.view);
  const el = target(c);
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  el.scrollIntoView({ block: "center" });
  const open = changes.filter((x) => target(x).dataset.state === "pending").length;
  status.textContent = `Change ${index + 1} of ${changes.length}: ${c.label}. ${open} awaiting review.`;
  const pending = el.dataset.state === "pending";
  bar.querySelector('[data-act="accept"]').disabled = !pending;
  bar.querySelector('[data-act="reject"]').disabled = !pending;
}

document.getElementById("run-demo").addEventListener("click", () => {
  changes.forEach((c) => { const el = target(c); c.apply(el); el.dataset.state = "pending"; });
  bar.hidden = false;
  index = 0;
  focusChange();
});

bar.addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (!act) return;
  const c = changes[index];
  const el = target(c);
  if (act === "prev") { index = (index + changes.length - 1) % changes.length; focusChange(); }
  if (act === "next") { index = (index + 1) % changes.length; focusChange(); }
  if (act === "accept") { el.dataset.state = "accepted"; focusChange(); }
  if (act === "reject") {
    c.revert(el); el.dataset.state = "rejected"; focusChange();
    feedback.hidden = false; document.getElementById("why").focus();
  }
  if (act === "send" || act === "skip") {
    feedback.hidden = true;
    status.textContent = act === "send"
      ? "Correction requested. In the app this creates a new reviewable change."
      : "Rejection kept. No reason given.";
    bar.querySelector('[data-act="next"]').focus();
  }
});

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-anchor]");
  if (a) { e.preventDefault(); history.pushState(null, "", a.getAttribute("href")); show("note", a.dataset.anchor); }
});
window.addEventListener("hashchange", route);
route();
