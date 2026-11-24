// Secret scan (PRD-076): looks for the fake test keys and common real-key shapes in the
// repository's tracked files, build output and test artefacts. Exit code 1 on a hit.
//   node scripts/secret-scan.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fakeKeys = ["nexus-fake-key-7f3a9c2e1b", "nexus-fake-e2e-key-5d1c8a", "nexus-fake-ask-key-3b9e", "nexus-fake-live-key-0c4d", "nexus-sentinel-K7q2Zp9Lw4Rt8Vx1Hc6"];
const shapes = [/\bsk-[A-Za-z0-9_-]{20,}/, /\bgsk_[A-Za-z0-9]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/, /\bsk-or-v1-[a-f0-9]{40,}/];
// Test sources legitimately contain the fake keys; everything else must not.
const allowFake = (rel) => /^(server\/src\/.*\.test\.ts|tests\/e2e\/.*\.spec\.ts|scripts\/secret-scan\.mjs)$/.test(rel);

const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const walk = (dir) => existsSync(dir) ? readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : [];
const extra = ["server/dist", "apps/web/dist", "apps/desktop/dist", ".tmp/test-results"].flatMap((d) => walk(join(root, d)));
const files = [...new Set([...tracked.map((f) => join(root, f)), ...extra])];

const hits = [];
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (rel.startsWith("node_modules/") || rel.startsWith(".kiro/skills/")) continue;
  let text;
  try { if (statSync(file).size > 20_000_000) continue; text = readFileSync(file, "latin1"); } catch { continue; }
  for (const k of fakeKeys) if (text.includes(k) && !allowFake(rel)) hits.push(`${rel}: fake test key ${k}`);
  for (const re of shapes) if (re.test(text)) hits.push(`${rel}: looks like a real API key (${re.source})`);
}
console.log(hits.length ? `Secret scan FAILED:\n${hits.join("\n")}` : `Secret scan passed: ${files.length} files checked.`);
process.exit(hits.length ? 1 : 0);
