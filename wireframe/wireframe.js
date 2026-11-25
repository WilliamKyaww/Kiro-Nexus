// Nexus wireframe: fictional data, two fixed demo changes, no AI and no persistence.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const icon = (id, cls = "i") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

// ---- Dates (the sample workspace's "today" is fixed) ----
const TODAY = "2026-11-24";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const parts = (iso) => iso.split("-").map(Number);
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const dow = (s) => (new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7;
const fmtLong = (s) => { const [y, m, d] = parts(s); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`; };
const fmtShort = (s) => { const [, m, d] = parts(s); return `${d} ${MONTHS[m - 1].slice(0, 3)}`; };
const fmtFull = (s) => { const [, m, d] = parts(s); return `${d} ${MONTHS[m - 1]}`; };
const fmtDay = (s) => `${DAYS[dow(s)]} ${fmtFull(s)}`;

// ---- Fictional workspace ----
const STATUS = { todo: "To do", progress: "In progress", done: "Done" };
const ORDER = ["todo", "progress", "done"];
const PRIORITY = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

const issues = {
  "NEX-1": { title: "Build calendar view", status: "progress", priority: "high", due: "2026-12-05", who: "Hein",
    note: { id: "kickoff", anchor: "actions", label: "Kickoff, 24 November › Actions" },
    body: "Month and agenda views of dated issues and events. Agreed at the kickoff; Hein owns it.",
    activity: [["Will", "created the issue from the kickoff", "24 Nov, 14:40"], ["Will", "linked Kickoff, 24 November › Actions", "24 Nov, 14:41"], ["Hein", "moved it to In progress", "24 Nov, 16:10"]] },
  "NEX-3": { title: "Record the demo video", status: "todo", priority: "medium", due: "2026-12-03", who: "Will",
    note: { id: "demo-script", label: "Demo script" }, body: "Under three minutes, following the demo script." },
  "NEX-4": { title: "Choose an open-source licence", status: "todo", priority: "low", due: null, who: "Will",
    body: "An OSI licence that GitHub detects in the About section." },
  "NEX-5": { title: "Package the Windows zip", status: "todo", priority: "urgent", due: "2026-12-02", who: "Will",
    body: "A portable zip of the desktop app that judges can unpack and run." },
  "NEX-6": { title: "Write the sample workspace", status: "done", priority: "medium", due: "2026-11-23", who: "Hein",
    note: { id: "sample-workspace", label: "Sample workspace" }, body: "One meeting note, one project and a few issues, all fictional." },
  "NEX-7": { title: "Mask the key prompt in Settings", status: "done", priority: "medium", due: null, who: "Will",
    body: "Keys never reach the workspace, the browser or the logs." },
};
let boardOrder = ["NEX-5", "NEX-3", "NEX-4", "NEX-1", "NEX-6", "NEX-7"];

const notes = {
  kickoff: { title: "Kickoff, 24 November", path: ["meetings", "2026-11-24 kickoff.md"], links: ["demo-script", "weekly-sync"], mentions: ["NEX-1"], saved: "Saved · edited 10 minutes ago" },
  "weekly-sync": { title: "Weekly sync, 1 December", path: ["meetings", "2026-12-01 weekly sync.md"], links: ["kickoff"], mentions: ["NEX-3"], saved: "Saved · edited yesterday" },
  "demo-script": { title: "Demo script", path: ["planning", "demo script.md"], links: ["sample-workspace", "kickoff"], mentions: ["NEX-3"], saved: "Saved · edited 23 Nov" },
  "sample-workspace": { title: "Sample workspace", path: ["planning", "sample workspace.md"], links: ["demo-script"], mentions: ["NEX-6"], saved: "Saved · edited 22 Nov" },
  "graph-idea": { title: "Graph view idea", path: ["ideas", "graph view.md"], links: [], mentions: [], saved: "Saved · edited today" },
};
const noteHref = (id) => (id === "kickoff" ? "#/note" : `#/note/${id}`);

const events = [
  { date: "2026-11-23", time: "16:00", title: "Design review", kind: "event" },
  { date: "2026-11-24", time: "14:00", title: "Kickoff meeting", kind: "event", note: "kickoff" },
  { date: "2026-12-01", time: "10:00", title: "Weekly sync", kind: "event", note: "weekly-sync" },
  { date: "2026-12-02", title: "Feature freeze", kind: "deadline" },
  { date: "2026-12-04", time: "22:00", title: "Submission closes", kind: "deadline" },
];

// ---- The two fixed review changes ----
const changes = [
  { id: "chg-note", view: "note", param: "kickoff", route: "#/note", where: "Kickoff › Actions", what: "tick “Hein builds the calendar view”", state: "none" },
  { id: "chg-issue", view: "issue", param: "NEX-1", route: "#/issue/NEX-1", where: "NEX-1 due date", what: "5 Dec 2026 to 3 Dec 2026", state: "none" },
];
const [chgNote, chgIssue] = changes;
const live = (c) => c.state === "pending" || c.state === "accepted";
const dueOf = (key) => (key === "NEX-1" && live(chgIssue) ? "2026-12-03" : issues[key].due);
const pendingDue = (key) => key === "NEX-1" && chgIssue.state === "pending";
const stateAttr = (c) => (c.state === "none" ? "" : ` data-state="${c.state}"`);

// ---- Small pieces ----
const stIcon = (s) => `<svg class="st st-${s}" role="img" aria-label="${STATUS[s]}"><use href="#i-st-${s}"/></svg>`;
const prio = (p) => (p === "urgent"
  ? `<svg class="prio-urgent" role="img" aria-label="Priority: Urgent"><use href="#i-urgent"/></svg>`
  : `<span class="prio prio-${p}" role="img" aria-label="Priority: ${PRIORITY[p]}"><i></i><i></i><i></i></span>`);
const avatar = (who) => `<span class="av av-${who.toLowerCase()}" role="img" aria-label="${who}">${who[0]}</span>`;
const dueTag = (key, short = true) => {
  const d = dueOf(key);
  if (!d) return "";
  const late = d < TODAY && issues[key].status !== "done" ? " late" : "";
  const pend = pendingDue(key) ? ' data-state="pending"' : "";
  return `<span class="due${late}"${pend}>${icon("calendar")}${short ? fmtShort(d) : fmtLong(d)}${pend ? '<span class="sr-only"> (pending review)</span>' : ""}</span>`;
};
const toast = (() => {
  let timer;
  return (msg) => {
    const t = $(".toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(timer); timer = setTimeout(() => { t.hidden = true; }, 4200);
  };
})();

// ---- Renderers ----
function renderHome() {
  const open = Object.values(issues).filter((i) => i.status !== "done");
  $('[data-bind="open-count"]').textContent = open.length;
  $('[data-bind="week-count"]').textContent = Object.keys(issues).filter((k) => issues[k].status !== "done" && dueOf(k) && dueOf(k) <= "2026-12-05").length;
  const keys = Object.keys(issues).filter((k) => issues[k].status !== "done" && dueOf(k)).sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
  $('[data-render="due-soon"]').innerHTML = keys.map((k) => `<li><a class="row" href="#/issue/${k}">${stIcon(issues[k].status)}
    <span class="row-main"><strong><span class="key">${k}</span> ${esc(issues[k].title)}</strong><small>${STATUS[issues[k].status]} · ${issues[k].who}</small></span>${dueTag(k)}</a></li>`).join("");
}

function cardHTML(k) {
  const it = issues[k];
  return `<li class="card" draggable="true" data-key="${k}"${pendingDue(k) ? ' data-state="pending"' : ""}>
    <div class="card-top"><span class="key">${k}</span>${avatar(it.who)}</div>
    <a class="card-title" href="#/issue/${k}">${esc(it.title)}</a>
    <div class="card-meta">${prio(it.priority)}${dueTag(k)}${pendingDue(k) ? '<span class="pending-tag">Pending</span>' : ""}${it.note ? `<span class="card-note" title="Linked to ${esc(it.note.label)}">${icon("link")}<span class="sr-only">Linked to ${esc(it.note.label)}</span></span>` : ""}</div>
  </li>`;
}

function renderBoard() {
  $('[data-render="board"]').innerHTML = ORDER.map((s) => {
    const keys = boardOrder.filter((k) => issues[k].status === s);
    return `<section class="col" data-status="${s}" aria-labelledby="col-${s}">
      <header class="col-head">${stIcon(s)}<h2 id="col-${s}">${STATUS[s]}</h2><span class="col-count">${keys.length}</span>
        <button class="icon-btn" type="button" aria-label="Add an issue to ${STATUS[s]}" data-toast="New issue: in the app this adds a card to ${STATUS[s]} and opens it.">${icon("plus")}</button></header>
      <ul class="cards">${keys.map(cardHTML).join("")}</ul>${keys.length ? "" : '<p class="col-empty">Drop issues here</p>'}
    </section>`;
  }).join("");
  const keys = [...boardOrder].sort((a, b) => (dueOf(a) || "9999").localeCompare(dueOf(b) || "9999"));
  $('[data-render="backlog"]').innerHTML = `<table class="table"><caption class="sr-only">All NEX issues, soonest due first</caption>
    <thead><tr><th scope="col">Issue</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Due</th><th scope="col">Assignee</th></tr></thead>
    <tbody>${keys.map((k) => `<tr><td><a class="cell-title" href="#/issue/${k}"><span class="key">${k}</span> ${esc(issues[k].title)}</a></td>
      <td><span class="cell-st">${stIcon(issues[k].status)}${STATUS[issues[k].status]}</span></td><td><span class="cell-st">${prio(issues[k].priority)}${PRIORITY[issues[k].priority]}</span></td>
      <td>${dueTag(k, false) || '<span class="muted">None</span>'}</td><td><span class="cell-st">${avatar(issues[k].who)}${issues[k].who}</span></td></tr>`).join("")}</tbody></table>`;
}

function moveIssue(k, status, announce) {
  if (!STATUS[status] || issues[k].status === status) return;
  issues[k].status = status;
  boardOrder = [...boardOrder.filter((x) => x !== k), k];
  renderAll();
  if (announce) $('[data-render="board-live"]').textContent = `${k} moved to ${STATUS[status]}.`;
}

function renderIssue(k) {
  const key = issues[k] ? k : "NEX-1";
  const it = issues[key];
  const target = key === "NEX-1";
  const d = dueOf(key);
  const dueCell = target
    ? `<dd data-target="chg-issue"${stateAttr(chgIssue)}><span class="value">${fmtLong(d)}</span>${chgIssue.state === "pending" ? '<span class="was">was 5 Dec 2026</span><span class="pending-tag">Pending review</span>' : ""}</dd>`
    : `<dd>${d ? fmtLong(d) : '<span class="muted">No due date</span>'}</dd>`;
  const select = (name, map, value) => `<select data-field="${name}" aria-label="${name === "status" ? "Status" : "Priority"}">${Object.entries(map).map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  const linked = it.note ? `<a class="linked-note" href="${noteHref(it.note.id)}"${it.note.anchor ? ` data-anchor="${it.note.anchor}"` : ""}>${icon("note")}${esc(it.note.label)}</a>` : '<span class="muted">No linked notes</span>';
  $('[data-render="issue"]').innerHTML = `<div class="issue-layout">
    <div class="issue-main">
      <p class="crumbs"><a href="#/board">Nexus hackathon</a>${icon("chevron-right")}${key}</p>
      <h1 id="issue-h"><span class="issue-key">${key}</span> ${esc(it.title)}</h1>
      <p class="issue-body">${esc(it.body)}</p>
      <h2>Linked notes</h2><p>${linked}</p>
      <h2>Activity</h2>
      <ol class="activity">${(it.activity || [[it.who, "created the issue", "earlier"]]).map(([who, what, when]) => `<li>${avatar(who)}<span><strong>${who}</strong> ${esc(what)}<time>· ${when}</time></span></li>`).join("")}</ol>
    </div>
    <aside class="props" aria-label="Properties">
      <dl>
        <dt>Status</dt><dd class="prop-sel">${stIcon(it.status)}${select("status", STATUS, it.status)}</dd>
        <dt>Priority</dt><dd class="prop-sel">${prio(it.priority)}${select("priority", PRIORITY, it.priority)}</dd>
        <dt>Due date</dt>${dueCell}
        <dt>Assignee</dt><dd class="prop-sel">${avatar(it.who)}${it.who}</dd>
        <dt>Project</dt><dd class="prop-sel"><span class="proj-dot" aria-hidden="true"></span>Nexus hackathon</dd>
      </dl>
    </aside>
  </div>`;
  $('[data-render="issue"]').dataset.key = key;
}

let calMonth = [2026, 11];
let calView = matchMedia("(max-width: 640px)").matches ? "agenda" : "month";
function itemsOn(day) {
  const list = [];
  Object.keys(issues).forEach((k) => { if (dueOf(k) === day) list.push({ kind: "issue", key: k }); });
  if (pendingDue("NEX-1") && issues["NEX-1"].due === day) list.push({ kind: "was", key: "NEX-1" });
  events.forEach((e) => { if (e.date === day) list.push(e); });
  return list;
}
function itemHTML(x) {
  if (x.kind === "was") return `<a class="ev ev-was" href="#/issue/${x.key}"><span class="ev-label"><span class="key">${x.key}</span> was due here<span class="sr-only"> until the pending change is decided</span></span></a>`;
  if (x.kind === "issue") {
    const it = issues[x.key];
    return `<a class="ev ev-issue${it.status === "done" ? " is-done" : ""}" href="#/issue/${x.key}"${pendingDue(x.key) ? ' data-state="pending"' : ""}>${stIcon(it.status)}<span class="ev-label"><span class="key">${x.key}</span> ${esc(it.title)}${pendingDue(x.key) ? '<span class="sr-only"> (date pending review)</span>' : ""}</span></a>`;
  }
  const inner = `<span class="ev-dot" aria-hidden="true"></span><span class="ev-label">${x.time ? `<span class="ev-time">${x.time}</span> ` : ""}${esc(x.title)}</span>`;
  return x.note ? `<a class="ev ev-${x.kind}" href="${noteHref(x.note)}">${inner}</a>` : `<span class="ev ev-${x.kind}">${inner}</span>`;
}
function renderCalendar() {
  const [y, m] = calMonth;
  $('[data-render="cal-title"]').textContent = `${MONTHS[m - 1]} ${y}`;
  const first = iso(y, m, 1);
  const lead = dow(first);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysIn) / 7) * 7;
  let rows = "";
  for (let i = 0; i < cells; i++) {
    const day = iso(y, m, 1 - lead + i);
    const [, dm, dd] = parts(day);
    if (i % 7 === 0) rows += "<tr>";
    const items = itemsOn(day);
    rows += `<td class="${dm !== m ? "out" : ""}${day === TODAY ? " today" : ""}"><div class="day"><time datetime="${day}"${day === TODAY ? ' aria-current="date"' : ""}><span class="sr-only">${DAYS[i % 7]} </span>${dd}${dm !== m ? `<span class="sr-only"> ${MONTHS[dm - 1]}</span>` : ""}</time>
      ${items.length ? `<ul>${items.map((x) => `<li>${itemHTML(x)}</li>`).join("")}</ul>` : ""}</div></td>`;
    if (i % 7 === 6) rows += "</tr>";
  }
  $('[data-render="month"]').innerHTML = `<table class="month-table"><caption class="sr-only">${MONTHS[m - 1]} ${y}</caption>
    <thead><tr>${DAYS.map((d) => `<th scope="col"><abbr title="${d}">${d.slice(0, 3)}</abbr></th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  const days = [...new Set([...events.map((e) => e.date), ...Object.keys(issues).map(dueOf).filter(Boolean)])].filter((d) => d >= TODAY).sort();
  $('[data-render="agenda"]').innerHTML = days.map((d) => `<section class="agenda-day"><h2>${d === TODAY ? "Today, " : ""}${fmtDay(d)}</h2><ul>${itemsOn(d).map((x) => `<li>${itemHTML(x)}</li>`).join("")}</ul></section>`).join("");
  $('[data-render="month"]').hidden = calView !== "month";
  $('[data-render="agenda"]').hidden = calView !== "agenda";
  $$("[data-calview]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.calview === calView)));
}

function renderNoteChecklist() {
  const li = $('[data-target="chg-note"]');
  li.dataset.state = chgNote.state === "none" ? "" : chgNote.state;
  if (chgNote.state === "none") li.removeAttribute("data-state");
  $(".check", li).dataset.checked = String(live(chgNote));
}

function graphModel() {
  const nodes = [
    ["kickoff", 440, 250], ["demo-script", 255, 170], ["weekly-sync", 610, 160], ["sample-workspace", 140, 320], ["graph-idea", 760, 450],
    ["NEX-1", 575, 360], ["NEX-3", 430, 80], ["NEX-6", 205, 455], ["NEX-4", 790, 95], ["NEX-5", 95, 95], ["NEX-7", 340, 480],
  ].map(([id, x, y]) => ({ id, x, y, issue: !!issues[id] }));
  const edges = new Map();
  const add = (a, b) => { const k = [a, b].sort().join("|"); edges.set(k, [a, b]); };
  Object.entries(notes).forEach(([id, n]) => { n.links.forEach((l) => add(id, l)); n.mentions.forEach((k) => add(id, k)); });
  Object.entries(issues).forEach(([k, it]) => { if (it.note) add(k, it.note.id); });
  const list = [...edges.values()];
  nodes.forEach((n) => { n.links = list.filter((e) => e.includes(n.id)).map((e) => (e[0] === n.id ? e[1] : e[0])); });
  return { nodes, edges: list };
}
const graph = graphModel();
const nodeTitle = (id) => (issues[id] ? `${id} ${issues[id].title}` : notes[id].title);
const nodeHref = (id) => (issues[id] ? `#/issue/${id}` : noteHref(id));
let graphSel = "kickoff";
const narrow = matchMedia("(max-width: 900px)");
function renderGraph() {
  // On narrow screens the same layout is transposed into a portrait frame, so every node and label fits.
  const tall = narrow.matches;
  const at = (n) => (tall ? { x: n.y, y: n.x } : { x: n.x, y: n.y });
  const pos = Object.fromEntries(graph.nodes.map((n) => [n.id, { ...at(n), issue: n.issue }]));
  const svg = $('[data-render="graph"]');
  svg.setAttribute("viewBox", tall ? "0 0 540 880" : "0 0 880 540");
  const edgeSVG = graph.edges.map(([a, b]) => `<line class="gedge${pos[a].issue || pos[b].issue ? " is-issue" : ""}" data-a="${a}" data-b="${b}" x1="${pos[a].x}" y1="${pos[a].y}" x2="${pos[b].x}" y2="${pos[b].y}"/>`).join("");
  const nodeSVG = graph.nodes.map((n) => {
    const { x, y } = pos[n.id];
    const r = n.issue ? 7 : 7 + n.links.length * 2.5;
    const shape = n.issue ? `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="3.5"/>` : `<circle cx="${x}" cy="${y}" r="${r}"/>`;
    const cls = `gnode${n.issue ? " is-issue" : ""}${!n.issue && !n.links.length ? " is-orphan" : ""}${n.id === graphSel ? " sel" : ""}`;
    const label = n.issue ? n.id : notes[n.id].title;
    return `<a class="${cls}" href="${nodeHref(n.id)}" data-id="${n.id}" aria-label="${n.issue ? "Issue" : "Note"}: ${esc(nodeTitle(n.id))}, ${n.links.length} ${n.links.length === 1 ? "link" : "links"}">${shape}<text x="${x}" y="${y + r + (tall ? 20 : 16)}">${esc(label)}</text></a>`;
  }).join("");
  svg.innerHTML = `<g class="gedges">${edgeSVG}</g><g class="gnodes">${nodeSVG}</g>`;
  $('[data-render="graph-summary"]').textContent = `${Object.keys(notes).length} notes, ${Object.keys(issues).length} issues and ${graph.edges.length} links. Bigger nodes have more links.`;
  graphSide(graphSel);
}
function graphSide(id) {
  const n = graph.nodes.find((x) => x.id === id);
  const kind = n.issue ? `Issue · ${STATUS[issues[id].status]}` : `Note · ${notes[id].path.join(" / ")}`;
  $('[data-render="graph-side"]').innerHTML = `<h2>${esc(nodeTitle(id))}</h2><p class="sub">${esc(kind)}</p>
    <h3>${n.links.length ? `Linked with ${n.links.length}` : "No links yet"}</h3>
    ${n.links.length ? `<ul class="mini">${n.links.map((l) => `<li><a class="mini-row" href="${nodeHref(l)}">${icon(issues[l] ? "board" : "note")}<span class="mini-title">${esc(nodeTitle(l))}</span></a></li>`).join("")}</ul>` : "<p class=\"muted\">Link it from another note with [[double brackets]].</p>"}
    <a class="btn btn-line" href="${nodeHref(id)}">Open ${n.issue ? "issue" : "note"}</a>`;
}
function highlight(id) {
  const svg = $('[data-render="graph"]');
  const n = graph.nodes.find((x) => x.id === id);
  svg.classList.toggle("focusing", !!n);
  $$(".gnode", svg).forEach((el) => el.classList.toggle("hl", !!n && (el.dataset.id === id || n.links.includes(el.dataset.id))));
  $$(".gedge", svg).forEach((el) => el.classList.toggle("hl", !!n && (el.dataset.a === id || el.dataset.b === id)));
}

let noteId = "kickoff";
function headingsOf(id) {
  return $$(`.doc[data-note="${id}"] h2`).map((h, i) => { if (!h.id) { h.id = `${id}-h${i}`; h.tabIndex = -1; } return { id: h.id, text: h.textContent }; });
}
function renderNote(id) {
  noteId = notes[id] ? id : "kickoff";
  const n = notes[noteId];
  $$(".doc").forEach((a) => { a.hidden = a.dataset.note !== noteId; });
  setNoteMode("preview");
  $('[data-render="note-path"]').innerHTML = `${esc(n.path[0])}${icon("chevron-right")}<strong>${esc(n.path[1])}</strong>`;
  $('[data-render="note-saved"]').textContent = n.saved;
  const folders = [...new Set(Object.values(notes).map((x) => x.path[0]))];
  $('[data-render="tree"]').innerHTML = folders.map((f) => `<li><span class="folder">${icon("folder")}${f}</span><ul>${Object.entries(notes).filter(([, x]) => x.path[0] === f)
    .map(([nid, x]) => `<li><a href="${noteHref(nid)}"${nid === noteId ? ' aria-current="page"' : ""}>${icon("note")}${esc(x.path[1].replace(/\.md$/, ""))}</a></li>`).join("")}</ul></li>`).join("");
  const linkedKeys = [...new Set([...Object.keys(issues).filter((k) => issues[k].note?.id === noteId), ...n.mentions])];
  const backlinks = Object.keys(notes).filter((x) => notes[x].links.includes(noteId));
  const miniIssue = (k) => `<li><a class="mini-issue" href="#/issue/${k}"${pendingDue(k) ? ' data-state="pending"' : ""}>
    <span class="mini-issue-top">${stIcon(issues[k].status)}<span><span class="key">${k}</span> ${esc(issues[k].title)}</span></span>
    <span class="mini-issue-meta">${STATUS[issues[k].status]} ${prio(issues[k].priority)}${dueTag(k)}</span></a></li>`;
  $('[data-render="note-details"]').innerHTML = `
    <section><h2>Outline</h2><ol class="outline">${headingsOf(noteId).map((h) => `<li><a href="${noteHref(noteId)}" data-anchor="${h.id}">${esc(h.text)}</a></li>`).join("")}</ol></section>
    <section><h2>Linked issues <span class="count">${linkedKeys.length}</span></h2>${linkedKeys.length ? `<ul class="mini">${linkedKeys.map(miniIssue).join("")}</ul>` : '<p class="muted">None yet</p>'}</section>
    <section><h2>Backlinks <span class="count">${backlinks.length}</span></h2>${backlinks.length ? `<ul class="mini">${backlinks.map((b) => `<li><a class="mini-row" href="${noteHref(b)}">${icon("note")}<span class="mini-title">${esc(notes[b].title)}</span></a></li>`).join("")}</ul>` : '<p class="muted">No other note links here</p>'}</section>
    <section><h2>Local graph</h2><a class="mini-graph" href="#/graph" data-graph-focus="${noteId}">${icon("graph")}Show in graph</a></section>`;
}
const sources = {
  kickoff: () => `# Kickoff, 24 November 2026\n\nWill and Hein · 24 November 2026, 14:00\n\n## Decisions\n\n- Nexus ships as a web app with a desktop wrapper.\n- Notes and issues live in one local workspace folder.\n- Hein owns the calendar view; Will owns the judge instructions.\n\n## Actions\n\n- [${live(chgNote) ? "x" : " "}] Hein builds the calendar view NEX-1\n- [ ] Will writes the judge instructions\n\n## Open questions\n\nWhich free provider should judges use? The options are in [[Demo script]].\n\nWe review progress at the [[Weekly sync, 1 December]].\n`,
  "weekly-sync": () => `# Weekly sync, 1 December 2026\n\n## Agenda\n\n- Progress on the actions from the [[Kickoff, 24 November]].\n- Watch the first cut of the demo video, NEX-3.\n- Agree the feature freeze for 2 December.\n\n## Notes\n\nTo be written during the meeting.\n`,
  "demo-script": () => `# Demo script\n\n## Story\n\nOpen the [[Sample workspace]], ask what is outstanding from the [[Kickoff, 24 November]], then fix it in Edit mode and review each change.\n\n## Provider options\n\n- A free hosted model with the judge's own key.\n- A team relay with a strict quota (still open).\n\nRecording is tracked in NEX-3.\n`,
  "sample-workspace": () => `# Sample workspace\n\nA fictional team workspace for judges: one meeting note, one project and a handful of issues. Everything in it is made up.\n\nUsed by the [[Demo script]]. Built in NEX-6.\n`,
  "graph-idea": () => `# Graph view idea\n\nShow notes and issues as one network, so an unlinked note stands out. Nothing links here yet, which is why it floats alone in the graph.\n`,
};
function setNoteMode(mode) {
  const src = mode === "edit";
  $$("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $(".source").hidden = !src;
  $$(".doc").forEach((a) => { a.hidden = src || a.dataset.note !== noteId; });
  if (src) $("#source").value = sources[noteId]();
}

function renderReminder() {
  // A pending date never moves a reminder: it keeps the accepted date until the change is accepted.
  const pending = chgIssue.state === "pending";
  const d = fmtFull(pending ? issues["NEX-1"].due : dueOf("NEX-1"));
  $('[data-render="nex1-reminder"]').innerHTML = `${icon("clock", "i row-icon")}<span class="row-main"><strong>NEX-1 Build calendar view, due ${d}</strong>
    <small>${pending ? `Reminder stays at 09:00 on ${d} until the new date is accepted` : `Reminder at 09:00 on ${d}`}</small></span>`;
}

function renderMentions() {
  $$("a.mention").forEach((a) => {
    const k = a.getAttribute("href").split("/").pop();
    if (issues[k]) a.innerHTML = `${stIcon(issues[k].status)}${k}`;
  });
}

function renderAll() {
  renderHome(); renderBoard(); renderCalendar(); renderNoteChecklist(); renderNote(noteId); renderReminder(); renderMentions();
  if (current.view === "issue") renderIssue(current.param || "NEX-1");
}

// ---- Routing ----
const VIEWS = new Set($$("[data-view]").map((s) => s.dataset.view));
const NAV_FOR = { conversation: "home", issue: "board" };
const TITLES = { home: "Home", conversation: "Conversation", note: "Notes", graph: "Graph", board: "Projects", issue: "Issue", calendar: "Calendar", notifications: "Notifications", settings: "Settings" };
let current = { view: "home", param: null };
function parseHash(h = location.hash) {
  const [view, param] = h.replace(/^#\/?/, "").split("/");
  return { view: VIEWS.has(view) ? view : "home", param: param ? decodeURIComponent(param) : null };
}
function show(view, param = null, anchor = null) {
  current = { view, param };
  $$("[data-view]").forEach((s) => { s.hidden = s.dataset.view !== view; });
  const nav = NAV_FOR[view] || view;
  $$("[data-nav]").forEach((a) => { if (a.dataset.nav === nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (view === "note") renderNote(param || "kickoff");
  if (view === "issue") renderIssue(param || "NEX-1");
  if (view === "calendar") renderCalendar();
  if (view === "graph") renderGraph();
  // On a narrow board, bring a card with a pending change into view.
  const pendingCard = view === "board" && $('.card[data-state="pending"]');
  if (pendingCard) {
    const cols = $('[data-render="board"]');
    requestAnimationFrame(() => { cols.scrollLeft = Math.max(0, pendingCard.closest(".col").offsetLeft - cols.offsetLeft - 24); });
  }
  document.title = `${view === "note" ? notes[noteId].title : view === "issue" ? $('[data-render="issue"]').dataset.key : TITLES[view]} · Nexus wireframe`;
  setNav(false);
  const main = $("#main");
  const el = anchor && document.getElementById(anchor);
  if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center" }); }
  else { main.scrollTop = 0; main.focus({ preventScroll: true }); }
}
const route = () => { const r = parseHash(); show(r.view, r.param); };

// ---- Review flow ----
let index = 0;
const bar = $(".review-bar");
const statusEl = $(".review-status");
const feedback = $(".feedback");
const target = (c) => document.querySelector(`[data-target="${c.id}"]`);
function flash(el) {
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}
function updateBar() {
  const c = changes[index];
  const open = changes.filter((x) => x.state === "pending").length;
  const word = { pending: "Pending", accepted: "Accepted", rejected: "Rejected" }[c.state];
  statusEl.innerHTML = `<strong>Change ${index + 1} of ${changes.length}</strong> <span class="review-what">${esc(c.where)}: ${esc(c.what)}</span> <span class="review-state" data-state="${c.state}">${word}</span> <span class="review-open">${open ? `${open} awaiting review` : "All changes reviewed"}</span>`;
  ["accept", "reject"].forEach((a) => {
    const b = $(`[data-act="${a}"]`);
    b.disabled = c.state !== "pending";
    b.hidden = open === 0;
  });
  $('[data-act="done"]').hidden = open > 0;
}
function goToChange() {
  const c = changes[index];
  if (location.hash !== c.route) history.replaceState(null, "", c.route);
  show(c.view, c.param);
  const el = target(c);
  flash(el);
  el.scrollIntoView({ block: "nearest" });
  updateBar();
}
// The panel ends above the review bar, so the bar never covers content.
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight}px`);
}).observe(bar);
$("#run-demo").addEventListener("click", () => {
  changes.forEach((c) => { c.state = "pending"; });
  index = 0;
  bar.hidden = false; feedback.hidden = true;
  document.body.classList.add("reviewing");
  renderAll();
  goToChange();
});
bar.addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (!act) return;
  const c = changes[index];
  if (act === "prev") { index = (index + changes.length - 1) % changes.length; goToChange(); }
  if (act === "next") { index = (index + 1) % changes.length; goToChange(); }
  if (act === "accept") { c.state = "accepted"; renderAll(); goToChange(); }
  if (act === "reject") {
    c.state = "rejected"; renderAll(); goToChange();
    feedback.hidden = false; $("#why").focus();
  }
  if (act === "send" || act === "skip") {
    feedback.hidden = true;
    statusEl.textContent = act === "send" ? "Correction sent. In the app, Nexus proposes a new change for you to review." : "Rejection kept. No reason given.";
    $('[data-act="next"]').focus();
  }
  if (act === "done") { bar.hidden = true; document.body.classList.remove("reviewing"); $("#main").focus(); }
});
feedback.addEventListener("submit", (e) => { e.preventDefault(); $('[data-act="send"]').click(); });

// ---- Command palette (Ctrl K) ----
const palette = $(".palette");
const palInput = $("input", palette);
const palList = $("#palette-list");
let palActive = 0;
const palItems = () => [
  ...Object.entries(notes).map(([id, n]) => ({ label: n.title, hint: n.path.join(" / "), href: noteHref(id), icon: "note" })),
  ...Object.entries(issues).map(([k, it]) => ({ label: `${k} ${it.title}`, hint: STATUS[it.status], href: `#/issue/${k}`, icon: "board" })),
  ...[["Home", "home", "home"], ["Graph", "graph", "graph"], ["Projects board", "board", "board"], ["Calendar", "calendar", "calendar"], ["Notifications", "notifications", "bell"], ["Settings", "settings", "settings"]]
    .map(([label, view, ic]) => ({ label, hint: "Go to", href: `#/${view}`, icon: ic })),
];
function renderPalette() {
  const q = palInput.value.trim().toLowerCase();
  const found = palItems().filter((x) => !q || `${x.label} ${x.hint}`.toLowerCase().includes(q)).slice(0, 9);
  palActive = Math.min(palActive, Math.max(found.length - 1, 0));
  palList.innerHTML = found.length ? found.map((x, i) => `<li role="option" id="pal-${i}" aria-selected="${i === palActive}" data-href="${x.href}">${icon(x.icon)}<span>${esc(x.label)}</span><small>${esc(x.hint)}</small></li>`).join("")
    : '<li class="pal-empty" role="presentation">No notes, issues or views match</li>';
  palInput.setAttribute("aria-activedescendant", found.length ? `pal-${palActive}` : "");
}
function openPalette() { palInput.value = ""; palActive = 0; renderPalette(); palette.showModal(); palInput.focus(); }
function goPalette(li) { if (!li?.dataset.href) return; palette.close(); location.hash = li.dataset.href; }
palInput.addEventListener("input", () => { palActive = 0; renderPalette(); });
palInput.addEventListener("keydown", (e) => {
  const n = $$("[role=option]", palList).length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (n) { palActive = (palActive + (e.key === "ArrowDown" ? 1 : n - 1)) % n; renderPalette(); } }
  if (e.key === "Enter") { e.preventDefault(); goPalette($(`#pal-${palActive}`)); }
});
palList.addEventListener("click", (e) => goPalette(e.target.closest("[role=option]")));
palette.addEventListener("click", (e) => { if (e.target === palette) palette.close(); });

// ---- Shell: navigation drawer, prototype dot, toasts ----
const menuBtn = $(".menu-btn");
const scrim = document.createElement("div");
scrim.className = "scrim";
document.body.append(scrim);
function setNav(open) { document.body.classList.toggle("nav-open", open); menuBtn.setAttribute("aria-expanded", String(open)); }
menuBtn.addEventListener("click", () => setNav(!document.body.classList.contains("nav-open")));
scrim.addEventListener("click", () => setNav(false));
const dot = $(".proto-dot");
const setTip = (open) => { dot.setAttribute("aria-expanded", String(open)); dot.parentElement.classList.toggle("open", open); };
dot.addEventListener("click", (e) => { e.stopPropagation(); setTip(dot.getAttribute("aria-expanded") !== "true"); });

document.addEventListener("click", (e) => {
  if (!e.target.closest(".proto")) setTip(false);
  const t = e.target.closest("[data-toast]");
  if (t) toast(t.dataset.toast);
  if (e.target.closest("[data-command-palette]")) openPalette();
  const a = e.target.closest("a[data-anchor]");
  if (a) {
    e.preventDefault();
    history.pushState(null, "", a.getAttribute("href"));
    const r = parseHash(a.getAttribute("href"));
    show(r.view, r.param, a.dataset.anchor);
  }
  const g = e.target.closest("[data-graph-focus]");
  if (g) graphSel = g.dataset.graphFocus;
  const card = e.target.closest(".card");
  if (card && !e.target.closest("a, button")) location.hash = `#/issue/${card.dataset.key}`;
  const mode = e.target.closest("[data-mode]");
  if (mode) setNoteMode(mode.dataset.mode);
  const cal = e.target.closest("[data-cal]");
  if (cal) {
    if (cal.dataset.cal === "today") calMonth = [2026, 11];
    else { const [y, m] = calMonth; const d = new Date(Date.UTC(y, m - 1 + Number(cal.dataset.cal), 1)); calMonth = [d.getUTCFullYear(), d.getUTCMonth() + 1]; }
    renderCalendar();
  }
  const cv = e.target.closest("[data-calview]");
  if (cv) { calView = cv.dataset.calview; renderCalendar(); }
  const tab = e.target.closest("[role=tab]");
  if (tab) selectTab(tab);
});
document.addEventListener("submit", (e) => { if (e.target.matches("[data-composer]")) e.preventDefault(); });
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (!palette.open) openPalette(); }
  if (e.key === "Escape") { setTip(false); setNav(false); }
  const title = e.target.closest?.(".card-title");
  if (title && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    const k = title.closest(".card").dataset.key;
    const next = ORDER[ORDER.indexOf(issues[k].status) + (e.key === "ArrowRight" ? 1 : -1)];
    if (next) { moveIssue(k, next, true); $(`.card[data-key="${k}"] .card-title`).focus(); }
  }
  const tab = e.target.closest?.("[role=tab]");
  if (tab && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    const tabs = $$("[role=tab]", tab.parentElement);
    const t = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(t); t.focus();
  }
});
function selectTab(tab) {
  $$("[role=tab]", tab.parentElement).forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  $(".board-hint").hidden = tab.id !== "tab-board";
}
document.addEventListener("change", (e) => {
  const f = e.target.closest("[data-field]");
  if (f) {
    const k = $('[data-render="issue"]').dataset.key;
    if (f.dataset.field === "status") { moveIssue(k, f.value, false); toast(`${k} moved to ${STATUS[f.value]}.`); }
    else { issues[k].priority = f.value; renderAll(); }
    $(`[data-field="${f.dataset.field}"]`).focus();
  }
  const g = e.target.closest("[data-graph]");
  if (g) $('[data-render="graph"]').classList.toggle(`hide-${g.dataset.graph}`, !g.checked);
});

// Graph hover and focus
const gsvg = $('[data-render="graph"]');
["mouseover", "focusin"].forEach((ev) => gsvg.addEventListener(ev, (e) => {
  const n = e.target.closest(".gnode");
  if (n) { highlight(n.dataset.id); graphSel = n.dataset.id; graphSide(n.dataset.id); $$(".gnode", gsvg).forEach((x) => x.classList.toggle("sel", x === n)); }
}));
["mouseleave", "focusout"].forEach((ev) => gsvg.addEventListener(ev, (e) => { if (!gsvg.contains(e.relatedTarget)) highlight(null); }));

// Board drag and drop
const boardEl = $('[data-render="board"]');
boardEl.addEventListener("dragstart", (e) => { const c = e.target.closest(".card"); if (c) { e.dataTransfer.setData("text/plain", c.dataset.key); c.classList.add("dragging"); } });
boardEl.addEventListener("dragend", () => $$(".dragging, .drop", boardEl).forEach((x) => x.classList.remove("dragging", "drop")));
boardEl.addEventListener("dragover", (e) => { const col = e.target.closest(".col"); if (col) { e.preventDefault(); $$(".col", boardEl).forEach((x) => x.classList.toggle("drop", x === col)); } });
boardEl.addEventListener("drop", (e) => { const col = e.target.closest(".col"); if (col) { e.preventDefault(); moveIssue(e.dataTransfer.getData("text/plain"), col.dataset.status, true); } });

// ---- Appearance (run 6, DEC-028): the quick switch in the top bar and Settings → Appearance ----
// theme-boot.js has already set the theme before the first paint; this keeps the controls in step.
const looks = window.nexusAppearance;
const LOOKS = {
  light: [["porcelain", "Porcelain", "Pale zinc shell, white work panel and an iris accent. The default."], ["linen", "Linen", "Warm paper greys with a deep teal accent."], ["mist", "Mist", "Cool blue-greys with a cobalt accent."]],
  dark: [["graphite", "Graphite", "Neutral graphite layers with a soft iris accent. The default."], ["midnight", "Midnight", "Blue-black layers with a sky-blue accent."], ["plum", "Plum", "Violet-black layers with a lilac accent."]],
};
let pref = looks.read();
const themeSwitch = $(".theme-switch");
// Each card is a labelled radio with a small preview drawn in that palette's own tokens.
for (const group of $$(".ap-group")) {
  const t = group.dataset.apTheme;
  $(".ap-cards", group).innerHTML = LOOKS[t].map(([id, name, text]) => `
    <label class="ap-card">
      <input class="sr-only" type="radio" name="ap-${t}" value="${id}">
      <span class="ap-preview" data-theme="${t}" data-palette="${id}" aria-hidden="true">
        <span class="pv-rail"><span class="pv-dot"></span><span class="pv-nav pv-on"></span><span class="pv-nav"></span><span class="pv-nav"></span></span>
        <span class="pv-panel"><span class="pv-title">Kickoff</span><span class="pv-text">Hein builds the <span class="pv-select">calendar</span> view</span><span class="pv-row"><span class="pv-cite">NEX-1</span><span class="pv-pend">Pending</span></span><span class="pv-button">Accept</span></span>
      </span>
      <span class="ap-name">${name}</span>
      <span class="ap-text">${text}</span>
      <span class="ap-selected"><svg class="i"><use href="#i-check"/></svg>Selected</span>
    </label>`).join("");
}
function syncLooks() {
  const shown = looks.apply(pref);
  const dark = shown === "dark";
  themeSwitch.setAttribute("aria-checked", String(dark));
  themeSwitch.title = dark ? "Switch to the light theme" : "Switch to the dark theme";
  $(".theme-switch-state", themeSwitch).textContent = dark ? "On" : "Off";
  $$('input[name="ap-mode"]').forEach((r) => { r.checked = r.value === pref.mode; });
  for (const t of ["light", "dark"]) {
    $$(`input[name="ap-${t}"]`).forEach((r) => {
      const on = r.value === pref[t];
      r.checked = on;
      r.closest(".ap-card").dataset.selected = String(on);
    });
  }
  $(".ap-now").textContent = `Showing the ${shown} theme${pref.mode === "system" ? ", as your computer is set to" : ""}. The Dark mode switch in the top bar does the same on any page.`;
}
function setLooks(change) {
  pref = { ...pref, ...change };
  if (!looks.save(pref)) toast("This browser would not store the choice, so it lasts until you close the tab.");
  syncLooks();
}
// From Match system, the switch picks the opposite of what is shown, as an explicit choice.
themeSwitch.addEventListener("click", () => setLooks({ mode: looks.theme(pref) === "dark" ? "light" : "dark" }));
document.addEventListener("change", (e) => {
  const r = e.target.closest('input[name="ap-mode"], input[name="ap-light"], input[name="ap-dark"]');
  if (!r) return;
  setLooks(r.name === "ap-mode" ? { mode: r.value } : { [r.name.slice(3)]: r.value });
});
looks.query?.addEventListener("change", () => { if (pref.mode === "system") syncLooks(); });
// Another tab of the wireframe changed the choice.
window.addEventListener("storage", (e) => { if (e.key === looks.KEY) { pref = looks.read(); syncLooks(); } });
syncLooks();

// ---- Start ----
$$("svg.i").forEach((s) => s.setAttribute("aria-hidden", "true"));
narrow.addEventListener("change", () => { if (current.view === "graph") renderGraph(); });
window.addEventListener("hashchange", route);
renderAll();
route();
