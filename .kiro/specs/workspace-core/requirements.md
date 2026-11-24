# Requirements: B1 workspace core

## Introduction

B1 is the first vertical slice of Nexus. A user opens Nexus in a browser or
in Electron, creates a Markdown note, creates a project issue linked to a
heading in that note, and navigates between the two. They then close Nexus,
reopen it and find both items intact. Every workspace read and write goes
through one local service that has a single-writer lock, atomic writes and
stale-save protection. Full notes features (B2), the board and calendar
(B3), reminders (B4) and the change journal (B5) are out of scope.

- **Traces to:** `docs/PRD/structure.md` (PRD-xxx) and
  `docs/PRD/architecture.md`
- **Approval:** written and self-reviewed by Kiro under Will's overnight
  authorisation of 24 November 2026. Human review is pending.

## Glossary

- **Service:** the local Node process that owns the workspace (DEC-005).
- **Workspace:** a folder chosen by the user that contains `.md` notes and
  `.nexus/`.
- **Profile:** a per-user app data folder that holds `service.json` and
  `recent.json`. Tests and trials use isolated profiles.
- **Revision:** a note's SHA-256 content hash, or a record's `revision`
  counter.

## Requirements

### Requirement 1: Launch and session (PRD-092, PRD-070)

**User story:** As a user, I want Nexus to open straight into my workspace
in a browser or in the desktop app, without other local software being able
to read my data.

1. WHEN the service starts THEN it SHALL listen only on `127.0.0.1` and
   SHALL print a ready line that contains the port and no secret.
2. WHEN the launcher opens Nexus THEN the browser SHALL receive a
   single-use launch code in the URL fragment, exchange it through
   `POST /api/v1/session` and remove the fragment from the address bar.
3. IF a launch code is reused, has expired or is unknown THEN the service
   SHALL respond `401` and issue no token.
4. IF a request to any `/api/v1/*` route other than `POST /session` has no
   valid bearer token THEN the service SHALL respond `401` with no workspace
   data. This includes the event stream.
5. IF a request's `Host` header is not `127.0.0.1:<port>` or
   `localhost:<port>` THEN the service SHALL respond `403`.
6. The service SHALL NOT send CORS headers and SHALL NOT write launch codes,
   tokens or the control secret to any log.
7. WHEN a fresh browser session without a token opens the app URL THEN the
   UI SHALL show how to open Nexus from its launcher and SHALL make no data
   request.
8. WHEN `npm run open` is run while the service is running THEN a new launch
   URL SHALL open a working session.

### Requirement 2: Workspace (PRD-003, PRD-090)

**User story:** As a user, I want to choose a folder or start from the
sample, so that my data lives in files I own.

1. WHEN a folder without `.nexus/` is opened THEN the service SHALL create
   `.nexus/workspace.json`, `projects.json` and `issues.json`, each with
   `schemaVersion: 1`.
2. WHEN the user chooses "Copy the sample workspace" THEN the service SHALL
   copy `samples/meeting-workspace` into a new folder that the user names
   and open the copy. The original SHALL never be opened for writing.
3. WHEN the service restarts with the same profile THEN it SHALL reopen the
   most recent workspace.
4. IF a `.nexus` JSON file fails validation THEN the service SHALL report
   which file failed and SHALL NOT overwrite it.
5. Each data file SHALL be described in `docs/data-format.md`.

### Requirement 3: Single writer (PRD-071)

**User story:** As a user, I want only one Nexus instance to write to a
workspace, so that two copies never overwrite each other.

1. WHEN a workspace is opened THEN the service SHALL create `.nexus/lock`
   exclusively, recording its pid, instance ID, port and start time.
2. IF the lock is held by a live process THEN a second service SHALL refuse
   to open the workspace with `423 LOCKED`, show the holder's port, and
   leave all files unchanged.
3. IF the lock's pid is not running THEN the service SHALL take the lock
   over and record that it did so.
4. WHEN the service shuts down normally THEN it SHALL remove its lock.

### Requirement 4: Safe writes (PRD-067, PRD-023)

**User story:** As a user, I want saves never to corrupt a file or silently
overwrite newer work.

1. The service SHALL write every workspace file atomically, by writing a
   temporary file in the same folder, flushing it, then renaming it over the
   target.
2. WHEN a note save or issue update carries a base revision that differs
   from the current one THEN the service SHALL respond
   `409 REVISION_MISMATCH` with the current value, and SHALL write nothing.
3. WHEN the UI receives a `409` THEN it SHALL keep the user's unsaved text,
   explain the conflict, and offer "Load latest" or "Overwrite with mine".
4. IF a path is outside the workspace, contains `..`, points into a
   dot-folder or is not `.md` THEN the service SHALL reject it with `400`.

### Requirement 5: Notes (PRD-002, PRD-020, PRD-021)

**User story:** As a user, I want to create and edit Markdown notes that
stay ordinary `.md` files.

1. WHEN the user creates a note with a title THEN the service SHALL create
   `<title>.md` (in a folder if one is given) containing exactly the content
   the user entered, plus nothing added by Nexus.
2. WHEN the user edits and saves a note THEN the file's bytes SHALL equal
   the editor's text.
3. The UI SHALL list notes in a folder tree, show a rendered preview, and
   show the note's outline of headings.

### Requirement 6: Projects and issues (PRD-003, PRD-030, PRD-031)

**User story:** As a user, I want to create a project and issues that are
stored as documented JSON.

1. WHEN the user creates a project with a key such as `NEX` THEN it SHALL be
   stored in `projects.json` with a stable ID.
2. WHEN the user creates an issue THEN it SHALL receive a stable prefixed ID
   and the next key (`NEX-1`, `NEX-2` and so on), and be stored in
   `issues.json` with `revision: 1`.
3. WHEN the user edits an issue's title, description, status, priority or
   due date THEN the record SHALL be updated, its `revision` incremented and
   `updatedAt` set.
4. The UI SHALL list a project's issues and show an issue detail page.

### Requirement 7: Heading links (PRD-024)

**User story:** As a user, I want to link an issue to a heading in a note
and move between them in both directions.

1. WHEN the user adds a note link to an issue THEN they SHALL choose a note,
   then optionally one of its headings, and the link SHALL be stored as
   `{ notePath, headingSlug, headingText }`.
2. WHEN the user opens the link from the issue THEN the note SHALL open,
   scrolled to that heading, with the heading visibly indicated.
3. WHEN a note is open THEN its side panel SHALL list every issue that links
   to it, with the heading each link targets. Choosing one SHALL open that
   issue.
4. IF the heading slug is no longer present but the heading text is unique
   THEN the link SHALL resolve to that heading. Otherwise it SHALL open the
   note with a "Heading not found" message.

### Requirement 8: Persistence across restart (R-D-B)

**User story:** As a user, I want my note, my issue and their link to be
intact after I close and reopen Nexus.

1. WHEN the service is stopped and started again with the same profile THEN
   the note, the issue and the link SHALL be shown exactly as they were last
   saved.
2. The files on disk and the UI SHALL agree. This is verified by reading the
   files directly in tests.

### Requirement 9: App shell and accessibility (PRD-011, PRD-080)

**User story:** As a keyboard user, I want to reach every section and
complete the B1 journey without a mouse.

1. The shell SHALL show Home, Notes, Projects, Calendar, Notifications and
   Settings in a navigation rail. Sections that are not yet built SHALL say
   so plainly.
2. Every interactive control SHALL be reachable with the keyboard and show a
   visible focus indicator.
3. Highlights SHALL fall back to a static outline when
   `prefers-reduced-motion` is set.
4. Home SHALL work with no provider configured and SHALL show "AI is off"
   without asking for a key.

### Requirement 10: Desktop wrapper (PRD-070, PRD-072)

**User story:** As a Windows user, I want the same app in a desktop window.

1. WHEN the desktop app starts THEN Electron main SHALL start the service in
   a `utilityProcess` with the app's profile, mint a launch code and load
   the UI.
2. The renderer SHALL run with `sandbox: true`, `contextIsolation: true` and
   `nodeIntegration: false`. Navigation away from the service origin and new
   windows SHALL be denied.
3. The preload SHALL expose only `window.nexusNative.appInfo()` and
   `pickWorkspaceFolder()`.
4. WHEN the desktop app is closed THEN the service SHALL stop and release
   the lock.
5. `NEXUS_PROFILE_DIR` SHALL isolate both Electron's user data and the
   service profile.

### Requirement 11: Commands and evidence

1. The repository SHALL provide `npm start`, `npm run try`, `npm run open`,
   `npm run desktop`, `npm test` and `npm run test:e2e`, each documented in
   `README.md`.
2. The repository SHALL record the Node versions that actually run (system
   and Electron) in `docs/toolchain.md`.
