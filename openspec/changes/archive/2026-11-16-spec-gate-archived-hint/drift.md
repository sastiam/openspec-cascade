---
egm: drift
status: resolved
hash: e2c1b9b0d4d69a38a55b52ead38698f71ad33b0b692388d85550263962da879d
---
# Drift report: spec-gate-archived-hint

## design.md

No drift detected

## specs/spec-gate/spec.md

- Path separator on Windows. The requirement fixes the path in the error line as `openspec/changes/archive/YYYY-MM-DD-<change>` and `openspec/changes/<change>` (forward slashes, repo-relative). `folderFailureOf` in `src/cli/spec_gate.ts` builds both paths with `node:path` `join`, which uses `\` on win32, so on Windows the lines would read `openspec\changes\archive\…` and `openspec\changes\foo`. On POSIX the output matches the spec exactly, and the tests assert it there.
  - Triage (2026-11-16): accepted by the user. openspec-cascade and forja run on macOS and Linux; no code or spec change.
