// Ask a running Nexus service to shut down cleanly (releases the workspace lock).
//   npm run stop            (real profile)
//   npm run stop -- --try   (the try workspace)
import { arg, defaultProfile, isAlive, readServiceFile, tryPaths } from "./launcher-lib.mjs";

const profile = process.argv.includes("--try") ? tryPaths.profile : (arg("profile") ?? defaultProfile());
const info = await readServiceFile(profile);
if (!info || !isAlive(info.pid)) {
  console.log("Nexus is not running for this profile.");
  process.exit(0);
}
const res = await fetch(`http://127.0.0.1:${info.port}/api/v1/shutdown`, { method: "POST", headers: { authorization: `Bearer ${info.controlSecret}` } }).catch(() => null);
if (!res?.ok) {
  console.error("Could not reach the Nexus service.");
  process.exit(1);
}
for (let i = 0; i < 50 && isAlive(info.pid); i++) await new Promise((r) => setTimeout(r, 100));
console.log(isAlive(info.pid) ? "Shutdown requested; the service is still closing." : "Nexus stopped.");
