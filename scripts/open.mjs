// Open a fresh browser session on a running Nexus service.
//   npm run open            (real profile)
//   npm run open -- --try   (the try workspace)
import { arg, defaultProfile, launchUrl, openInBrowser, tryPaths } from "./launcher-lib.mjs";

const profile = process.argv.includes("--try") ? tryPaths.profile : (arg("profile") ?? defaultProfile());
const url = await launchUrl(profile);
if (!url) {
  console.error(`Nexus is not running for profile ${profile}. Start it with "npm start" or "npm run try".`);
  process.exit(1);
}
if (process.argv.includes("--print")) console.log(url);
else {
  openInBrowser(url);
  console.log("Opened a new Nexus session in your browser.");
}
