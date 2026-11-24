// Kiro hook action (R-K5): when workspace-mutation code changes, run the focused
// review/reversal tests and append one result line to .tmp/hooks/review-tests.log.
// Reads the hook's JSON event on stdin; ignores edits outside the watched paths.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Hooks may start with a lower-case drive letter (c:\...). Vitest on Windows then loads two copies of itself and fails with "failed to find the runner", so normalise.
const root = realpathSync.native(join(dirname(fileURLToPath(import.meta.url)), "..")).replace(/^[a-z]:/, (d) => d.toUpperCase());
const watched = /(server[\\/]+src[\\/]+(review|workspace)[\\/]|packages[\\/]+schema[\\/]+src[\\/]+review\.ts)/i;

let input = "";
try {
  input = await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { data += d; });
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
} catch { /* no stdin */ }

// Only path-like fields count: file contents that merely mention a watched path must not trigger a run.
const pathKeys = new Set(["path", "file", "filePath", "file_path", "targetFile", "sourcePath", "destinationPath", "uri"]);
function collectPaths(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => collectPaths(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (pathKeys.has(k) && typeof v === "string") out.push(v);
      else collectPaths(v, out);
    }
  }
  return out;
}

const forced = process.argv.includes("--force");
let trigger = forced ? "manual" : "hook";
let file = forced ? "(forced)" : null;
try {
  const event = JSON.parse(input);
  trigger = event.hook_event_name ?? event.trigger ?? event.event ?? trigger;
  const hit = collectPaths(event).find((p) => watched.test(p));
  if (hit) file = hit.replace(/^.*?((?:server|packages)[\\/])/i, "$1").replace(/\\+/g, "/");
} catch {
  // Not JSON: treat the raw input as a path only if it is short and single-line.
  if (input.length < 600 && !input.includes("\n") && watched.test(input)) file = input.trim();
}
if (!file) process.exit(0);

const started = Date.now();
const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(process.execPath, [vitest, "run", "server/src/review", "server/src/workspace", "--reporter=dot"], {
  cwd: root, encoding: "utf8", timeout: 180_000, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
});
const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const tests = out.match(/Tests\s+([^\n]+)/)?.[1]?.trim() ?? "no summary";
const status = run.status === 0 ? "PASS" : "FAIL";
const line = `${new Date().toISOString()} ${status} trigger=${trigger} file=${file} tests="${tests}" duration=${((Date.now() - started) / 1000).toFixed(1)}s`;

const logDir = join(root, ".tmp", "hooks");
mkdirSync(logDir, { recursive: true });
appendFileSync(join(logDir, "review-tests.log"), line + "\n");
console.log(`Review/reversal tests: ${status} (${tests})`);
if (status === "FAIL") {
  const failures = out.split("\n").filter((l) => /FAIL|AssertionError|Error:/.test(l)).slice(0, 8).join("\n");
  console.log(failures);
}
process.exit(0);
