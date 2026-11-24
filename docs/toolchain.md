# Toolchain: what actually runs (DEC-013)

These versions were checked on 24 November 2026 on Will's Windows machine.
No system-wide upgrade was made.

| Component | Version | How it was checked |
| --- | --- | --- |
| System Node.js (dev, browser route, tests) | **24.14.0** | `node --version` |
| npm | 11.9.0 | `npm --version` |
| Electron | 45.4.1 | `node_modules/electron`, from `process.versions.electron` |
| Electron's bundled Node (runs the service in the desktop app) | **24.22.3** | `ELECTRON_RUN_AS_NODE=1 electron <script>` printing `process.versions.node` |
| Electron's Chromium | 156.0.8078.100 | Same check |
| TypeScript | 7.0.2 | `npx tsc --version` |
| Playwright | 1.65.1 | `npx playwright --version` |
| E2E browser | System Microsoft Edge (`channel: "msedge"`) | `playwright.config.ts`. No browser download is needed |

Both runtimes are on Node 24, which satisfies every package's `engines`
range. The strictest ranges are:

| Package | `engines` range |
| --- | --- |
| `chokidar` | `>=22.22` |
| `react-router` | `>=22.22.0` |
| `vitest` | `^22.12 \|\| ^24 \|\| >=26` |
| `electron` | `>=22.12` |

`.nvmrc` pins 24.14.0, and `package.json` `engines` allows
`^24.14.0 || >=26`.

The service bundle (`server/dist/main.mjs`) targets `node24`. It runs
unchanged under both the system Node and Electron's `utilityProcess`, and
both runs are covered by the E2E tests.
