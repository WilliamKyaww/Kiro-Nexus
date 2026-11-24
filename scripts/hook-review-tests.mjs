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

const forced = process.argv.includes("--force");
const match = input.match(watched);
if (!match && !forced) process.exit(0);

let trigger = "manual";
let file = "(forced)";
try {
  const event = JSON.parse(input);
  trigger = event.hook_event_name ?? event.trigger ?? event.event ?? "hook";
  const text = JSON.stringify(event);
  const pathMatch = text.match(/[A-Za-z0-9_.:\\/ -]*(?:server[\\/]+src[\\/]+(?:review|workspace)[\\/]+[A-Za-z0-9_.-]+|packages[\\/]+schema[\\/]+src[\\/]+review\.ts)/i);
  file = pathMatch ? pathMatch[0].replace(/^.*?(server|packages)/, "$1").replace(/\\+/g, "/") : "(unknown)";
} catch {
  if (match) file = match[0];
}

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
