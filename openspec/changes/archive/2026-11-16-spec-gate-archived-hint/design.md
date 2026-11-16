# Design

## Context

`spec-gate check` verifies that, for each change, the EGM report of a stage (`review.md` or `drift.md`) is resolved and fresh, and exits 1 otherwise; `forja wt night` calls it before an unattended run. `runCheck` in `src/cli/spec_gate.ts` maps each change name to `changeDirOf(repo, change)` and calls `evaluateStage`, which reports `missing` when the stage report is absent. It never looks at whether the change folder exists, so a missing folder reads as a missing report. Every failure today is one stderr line `<change>: <stage> <reason> (<file>)` (`spec_gate.ts:63`). `openspec archive` moves a change to `openspec/changes/archive/YYYY-MM-DD-<change>/` (for example `2026-11-16-tasks-lint`).

## Goals / Non-Goals

**Goals:**
- Tell an archived change and a change with no folder apart in `check`, before evaluating any stage.

**Non-Goals:**
- Passing the gate for an archived change: it still fails, only the message changes.
- `stamp` and `lint-tasks`: both already stop with an explicit message and exit 2, and only `check` runs before unattended runs.
- Looking inside archived folders (their reports, stamps or hashes).

## Decisions

- **One function, private to `src/cli/spec_gate.ts`, that does the I/O.** For a change name it returns one of: the change folder exists, archived (with the archive directory name), or no change folder. The folder exists when a directory is found at `changeDirOf(repo, change)`; then it wins over any archived copy and `evaluateStage` runs exactly as today. Otherwise the function lists `openspec/changes/archive/`; if that listing fails for any reason (missing or unreadable), it is treated as an empty archive, so the result is "no change folder" and the exit code stays 1. Alternative: a pure classifier plus a separate reader; rejected as a second abstraction for a few lines.
- **Exact archive name match, as a plain string comparison.** Only directory entries count. An entry matches when it starts with an anchored `YYYY-MM-DD-` prefix and the rest equals the change name exactly. The change name is never put inside a regular expression, because names may contain `.`. Alternative: "ends with `-<change>`"; rejected, because a check for `thing` would match the archive directory `2026-01-01-big-thing`.
- **Most recent archive wins.** Dated names sort chronologically as strings, so the greatest name is the latest archive.
- **Same line format, two new reasons.** The new lines reuse `<change>: <stage> <reason> (<path>)` with repo-relative paths and no trailing slash: `tasks-lint: review archived (openspec/changes/archive/2026-11-16-tasks-lint)` and `foo: review no change folder (openspec/changes/foo)`. The two reasons, the archive directory name and the date prefix pattern are named constants in `SPEC_GATE_CONSTANTS`, which already holds `OPENSPEC_DIR` and `CHANGES_DIR`.
- **Same exit code.** Both new cases keep `EXIT_CODE_ERROR` (1); a caller that reads only the exit code sees no difference, and the line format is unchanged.

## Risks / Trade-offs

- [`openspec/changes/archive/` is missing or unreadable] → treated as an empty archive: the change is reported as having no change folder, which is true for its active path.
- [A future OpenSpec version changes the archive naming] → archived changes would be reported as having no change folder; the message stays true because it is about the active folder.
