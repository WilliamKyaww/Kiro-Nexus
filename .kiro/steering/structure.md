---
inclusion: fileMatch
fileMatchPattern: ["apps/**/*", "server/**/*", "packages/**/*", "tests/**/*", ".kiro/specs/**/*"]
---

# Nexus architecture and repository structure

`docs/PRD/architecture.md` is authoritative for the repository layout, data
ownership, interfaces, the change review contract and failure behaviour.
Invariants to keep:

- All workspace reads and writes go through `WorkspaceService` in `server/`.
  Manual and agent edits share it.
- Every file write is atomic. The review journal is written before a
  tentative write.
- The agent has no accept, filesystem, shell or network tool.
- Keys never reach the workspace, the renderer storage, logs or builds.

#[[file:docs/PRD/architecture.md]]
