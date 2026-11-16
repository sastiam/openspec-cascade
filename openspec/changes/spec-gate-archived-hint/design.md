# Design

## Context

`runCheck` in `src/cli/spec_gate.ts` maps each change name to `changeDirOf(repo, change)` and calls `evaluateStage`, which reports `missing` when the stage report is absent. It never looks at whether the change folder exists, so a missing folder reads as a missing report. `openspec archive` moves a change to `openspec/changes/archive/YYYY-MM-DD-<change>/` (for example `2026-11-16-tasks-lint`).

## Goals / Non-Goals

**Goals:**
- Tell an archived change and an unknown change apart in `check`, before evaluating any stage.

**Non-Goals:**
- Passing the gate for an archived change: it still fails, only the message changes.
- `stamp`, `lint-tasks` or any other subcommand that resolves change folders.
- Looking inside archived folders (their reports, stamps or hashes).

## Decisions

- **Folder existence first, in `runCheck`.** A small pure function resolves a change name to one of: present, archived (with its folder), unknown. `runCheck` only calls `evaluateStage` for present changes. Alternative: teach `evaluateStage` about archives; rejected, because it evaluates a folder and should not know the archive layout.
- **Exact archive name match.** An archived folder matches only when its name is a `YYYY-MM-DD` date, a hyphen and the change name. Alternative: "ends with `-<change>`"; rejected, because `big-thing` would match `thing`.
- **Most recent archive wins.** Dated names sort chronologically as strings, so the greatest name is the latest archive.
- **Messages and patterns as named constants** in `SPEC_GATE_CONSTANTS` (archive dir name, date pattern, both message templates). The repo's forensic audit forbids comments inside function bodies and magic strings.
- **Same exit code.** Both new cases keep `EXIT_CODE_ERROR` (1); a caller that only reads the exit code sees no difference.

## Risks / Trade-offs

- [The archive folder is missing or unreadable] → treated as no archive: the change is reported unknown, never a crash.
- [A future OpenSpec version changes the archive naming] → the change would be reported unknown; the message still says the folder does not exist, which stays true.
