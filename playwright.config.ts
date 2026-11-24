import { defineConfig } from "@playwright/test";

// Uses the system Microsoft Edge by default (present on every Windows machine),
// so no browser download is needed. Override with NEXUS_E2E_CHANNEL=chrome.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: ".tmp/test-results",
  use: {
    channel: process.env.NEXUS_E2E_CHANNEL ?? "msedge",
    headless: process.env.NEXUS_E2E_HEADED !== "1",
    viewport: { width: 1360, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
