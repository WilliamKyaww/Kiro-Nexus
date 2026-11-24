// Integration tests against the real service process (B1 tasks 5 and 6).
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client, fakeWebDist, mintLaunchCode, openSession, rawRequest, startService, type RunningService } from "../test/harness";

let base: string;
const running: RunningService[] = [];
const start = async (opts: Parameters<typeof startService>[0]) => {
  const svc = await startService(opts);
  running.push(svc);
  return svc;
};

beforeEach(async () => { base = await mkdtemp(join(tmpdir(), "nexus-http-")); });
afterEach(async () => {
  for (const svc of running.splice(0)) await svc.stop();
  await rm(base, { recursive: true, force: true });
});

describe("session model (DEC-011)", () => {
  it("serves the shell without a token but protects every data route and the event stream", async () => {
    const webDist = await fakeWebDist(join(base, "web"));
    const svc = await start({ profile: join(base, "profile"), workspace: join(base), webDist });
    const url = (p: string) => `http://127.0.0.1:${svc.port}${p}`;

    const shell = await fetch(url("/"));
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("<div id=root>");
    expect(shell.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(shell.headers.get("access-control-allow-origin")).toBeNull();
    expect((await fetch(url("/notes/anything"))).status).toBe(200); // client-side route fallback

    for (const [method, path] of [["GET", "/api/v1/workspace"], ["GET", "/api/v1/notes"], ["GET", "/api/v1/notes/content?path=a.md"],
      ["POST", "/api/v1/notes"], ["GET", "/api/v1/issues"], ["PATCH", "/api/v1/issues/NEX-1"], ["GET", "/api/v1/events"], ["GET", "/api/v1/nonexistent"]] as const) {
      const res = await fetch(url(path), { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      expect(res.status, `${method} ${path}`).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHENTICATED");
      expect(JSON.stringify(body)).not.toContain("notes");
    }
    // A made-up bearer token is also refused.
    const forged = await fetch(url("/api/v1/workspace"), { headers: { authorization: "Bearer " + "x".repeat(43) } });
    expect(forged.status).toBe(401);
    // A session token cannot mint launch codes (control secret only).
    const token = await openSession(svc);
    expect((await fetch(url("/api/v1/launch-codes"), { method: "POST", headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("exchanges a launch code once, and rejects reuse", async () => {
    const svc = await start({ profile: join(base, "profile") });
    const code = await mintLaunchCode(svc);
    const exchange = () => fetch(`http://127.0.0.1:${svc.port}/api/v1/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ launchCode: code }) });
    const first = await exchange();
    expect(first.status).toBe(200);
    const { token } = await first.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await exchange()).status).toBe(401);
    const ws = await client(svc, token).get("/workspace");
    expect(ws.status).toBe(200);
    expect(ws.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const svc = await start({ profile: join(base, "profile") });
    const evil = await rawRequest(svc.port, "/api/v1/workspace", { host: `evil.example:${svc.port}` });
    expect(evil.status).toBe(403);
    expect((await rawRequest(svc.port, "/", { host: `attacker.test` })).status).toBe(403);
    expect((await rawRequest(svc.port, "/api/v1/workspace", { host: `localhost:${svc.port}` })).status).toBe(401);
  });

  it("streams events only to authenticated fetch clients", async () => {
    const svc = await start({ profile: join(base, "profile"), workspace: base });
    const token = await openSession(svc);
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${svc.port}/api/v1/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let seen = decoder.decode((await reader.read()).value);
    await client(svc, token).post("/notes", { path: "streamed.md", content: "# Hi\n" });
    while (!seen.includes("file.changed")) seen += decoder.decode((await reader.read()).value);
    expect(seen).toContain('"path":"streamed.md"');
    controller.abort();
  });

  it("never writes codes, tokens or the control secret to logs", async () => {
    const profile = join(base, "profile");
    const svc = await start({ profile, workspace: base });
    const code = await mintLaunchCode(svc);
    const res = await fetch(`http://127.0.0.1:${svc.port}/api/v1/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ launchCode: code }) });
    const { token } = await res.json();
    const api = client(svc, token);
    await api.get("/notes/content?path=private%20plans.md");
    await api.post("/notes", { path: "private plans.md", content: "secret body text" });
    await svc.stop();
    const logText = (await readFile(join(profile, "logs", "service.log"), "utf8")) + svc.stderr();
    for (const secret of [code, token, svc.controlSecret, "secret body text", "private plans"]) expect(logText).not.toContain(secret);
    expect(logText).toContain("http: POST /api/v1/session 200");
    expect(logText).toContain("http: GET /api/v1/notes/content 404");
  });
});

describe("persistence and single writer (B1 task 6)", () => {
  it("keeps a note and a linked issue across a restart, and files and API agree", async () => {
    const profile = join(base, "profile");
    const ws = join(base, "workspace");
    await import("node:fs/promises").then((fs) => fs.mkdir(ws));
    let svc = await start({ profile, workspace: ws });
    let api = client(svc, await openSession(svc));
    const content = "# Sprint plan\n\n## Actions\n\n- [ ] Ship B1\n";
    expect((await api.post("/notes", { path: "plans/sprint.md", content })).status).toBe(201);
    const project = (await api.post("/projects", { key: "NEX", name: "Nexus" })).body;
    const issue = (await api.post("/issues", { projectId: project.id, title: "Ship B1", due: { date: "2026-11-25" },
      noteLinks: [{ notePath: "plans/sprint.md", headingSlug: "actions", headingText: "Actions" }] })).body;
    expect(issue.key).toBe("NEX-1");
    await svc.stop();
    running.splice(running.indexOf(svc), 1);
    expect(await readdir(join(ws, ".nexus"))).not.toContain("lock");

    // Restart with the same profile and no --workspace: it reopens the recent workspace.
    svc = await start({ profile });
    api = client(svc, await openSession(svc));
    expect((await api.get("/workspace")).body.workspace.root).toBe(ws);
    const note = (await api.get("/notes/content?path=plans%2Fsprint.md")).body;
    expect(note.content).toBe(content);
    expect(note.linkedIssues).toEqual([{ key: "NEX-1", title: "Ship B1", status: "todo", headingSlug: "actions", headingText: "Actions", linkStatus: "ok" }]);
    const reloaded = (await api.get("/issues/NEX-1")).body;
    expect(reloaded.links[0]).toMatchObject({ notePath: "plans/sprint.md", status: "ok", resolvedSlug: "actions" });

    expect(await readFile(join(ws, "plans", "sprint.md"), "utf8")).toBe(content);
    const issuesOnDisk = JSON.parse(await readFile(join(ws, ".nexus", "issues.json"), "utf8"));
    expect(issuesOnDisk.issues[0]).toMatchObject({ key: "NEX-1", due: { date: "2026-11-25" }, revision: 1, noteLinks: [{ headingSlug: "actions" }] });
  });

  it("refuses a second instance on the same workspace and leaves files unchanged", async () => {
    const ws = join(base, "workspace");
    await import("node:fs/promises").then((fs) => fs.mkdir(ws));
    const first = await start({ profile: join(base, "p1"), workspace: ws });
    const api1 = client(first, await openSession(first));
    await api1.post("/notes", { path: "a.md", content: "one" });
    const lockBefore = await readFile(join(ws, ".nexus", "lock"), "utf8");
    const issuesBefore = await readFile(join(ws, ".nexus", "issues.json"), "utf8");

    const second = await start({ profile: join(base, "p2") });
    const api2 = client(second, await openSession(second));
    const res = await api2.post("/workspace/open", { path: ws });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe("LOCKED");
    expect(res.body.error.message).toContain(`port ${first.port}`);
    expect((await api2.get("/notes")).status).toBe(409); // NO_WORKSPACE: nothing opened

    expect(await readFile(join(ws, ".nexus", "lock"), "utf8")).toBe(lockBefore);
    expect(await readFile(join(ws, ".nexus", "issues.json"), "utf8")).toBe(issuesBefore);
    expect(await readFile(join(ws, "a.md"), "utf8")).toBe("one");
  });

  it("takes over a lock left by a crashed process", async () => {
    const ws = join(base, "workspace");
    await import("node:fs/promises").then((fs) => fs.mkdir(ws));
    const crashed = await start({ profile: join(base, "p1"), workspace: ws });
    crashed.child.kill("SIGKILL");
    await crashed.exited;
    running.splice(running.indexOf(crashed), 1);
    expect(await readdir(join(ws, ".nexus"))).toContain("lock");
    const next = await start({ profile: join(base, "p2"), workspace: ws });
    const api = client(next, await openSession(next));
    expect((await api.get("/workspace")).body.workspace.root).toBe(ws);
    expect(next.stderr()).toContain("took over stale lock");
  });
});
