// Smoke test for Microsoft Playwright MCP over stdio (dev tooling, R-K3).
// Starts the wireframe on loopback, starts @playwright/mcp in an isolated
// headless browser, lists its tools, and drives one real wireframe journey.
// Usage: node scripts/mcp-smoke.mjs
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";

const MCP_VERSION = "0.0.86";
const browser = process.env.NEXUS_MCP_BROWSER ?? "msedge";
const WIREFRAME_PORT = 47101; // fixed so --allowed-origins can name it
const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");

function startStatic() {
  return new Promise((resolveStart, reject) => {
    const child = spawn(process.execPath, ["scripts/serve-static.mjs", "wireframe", String(WIREFRAME_PORT)], { stdio: ["ignore", "pipe", "inherit"] });
    createInterface({ input: child.stdout }).once("line", (line) => {
      try { resolveStart({ child, port: JSON.parse(line).port }); } catch (e) { reject(e); }
    });
    child.once("error", reject);
  });
}

function startMcp() {
  const args = ["--yes", `@playwright/mcp@${MCP_VERSION}`, "--isolated", "--headless", "--browser", browser,
    "--allowed-origins", `http://127.0.0.1:${WIREFRAME_PORT}`];
  const child = spawn(process.execPath, [npxCli, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolveCall, rejectCall } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rejectCall(new Error(JSON.stringify(msg.error)));
      else if (msg.result?.isError) rejectCall(new Error((msg.result.content ?? []).map((c) => c.text).join(" ").slice(0, 300)));
      else resolveCall(msg.result);
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const send = (method, params) => new Promise((resolveCall, rejectCall) => {
    const id = nextId++;
    pending.set(id, { resolveCall, rejectCall });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.delete(id)) rejectCall(new Error(`timeout: ${method}\n${stderr}`)); }, 90_000);
  });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return { child, send, notify };
}

const text = (result) => (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const refFor = (snapshot, role, name) => {
  const line = snapshot.split("\n").find((l) => l.includes(`${role} "${name}`) && l.includes("[ref="));
  return line?.match(/\[ref=([^\]]+)\]/)?.[1];
};

const results = [];
const check = (label, ok, detail = "") => { results.push({ label, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`); };

const { child: staticServer, port } = await startStatic();
const mcp = startMcp();
try {
  const init = await mcp.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "nexus-mcp-smoke", version: "1.0.0" } });
  check("initialize", !!init?.serverInfo, `${init?.serverInfo?.name} ${init?.serverInfo?.version}`);
  mcp.notify("notifications/initialized", {});

  const tools = await mcp.send("tools/list", {});
  const names = tools.tools.map((t) => t.name);
  check("tool discovery", names.includes("browser_navigate") && names.includes("browser_snapshot"), `${names.length} tools`);

  await mcp.send("tools/call", { name: "browser_navigate", arguments: { url: `http://127.0.0.1:${port}/index.html` } });
  let snap = text(await mcp.send("tools/call", { name: "browser_snapshot", arguments: {} }));
  check("wireframe loads with the no-key state", snap.includes("AI is off") && snap.includes("Wireframe prototype"));

  const demo = refFor(snap, "button", "Apply fixed demo changes");
  await mcp.send("tools/call", { name: "browser_click", arguments: { element: "Apply fixed demo changes button", target: demo } });
  snap = text(await mcp.send("tools/call", { name: "browser_snapshot", arguments: {} }));
  check("review opens on the note with the first change", snap.includes("Change 1 of 2") && snap.includes("Kickoff, 24 November"));

  const accept = refFor(snap, "button", "Accept");
  await mcp.send("tools/call", { name: "browser_click", arguments: { element: "Accept button", target: accept } });
  const next = refFor(snap, "button", "Next");
  await mcp.send("tools/call", { name: "browser_click", arguments: { element: "Next button", target: next } });
  snap = text(await mcp.send("tools/call", { name: "browser_snapshot", arguments: {} }));
  check("next change moves to the issue page", snap.includes("NEX-1 Build calendar view") && snap.includes("3 Dec 2026"));

  const reject = refFor(snap, "button", "Reject");
  await mcp.send("tools/call", { name: "browser_click", arguments: { element: "Reject button", target: reject } });
  snap = text(await mcp.send("tools/call", { name: "browser_snapshot", arguments: {} }));
  check("reject reverses the date and asks for feedback", snap.includes("5 Dec 2026") && snap.includes("What was wrong"));

  await mcp.send("tools/call", { name: "browser_close", arguments: {} }).catch(() => {});
} catch (error) {
  check("smoke run", false, String(error.message ?? error).slice(0, 400));
} finally {
  mcp.child.kill();
  staticServer.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `Playwright MCP smoke: all ${results.length} checks passed` : `Playwright MCP smoke: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
