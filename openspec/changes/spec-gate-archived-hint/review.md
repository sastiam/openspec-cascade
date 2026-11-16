---
egm: review
status: resolved
hash: e2c1b9b0d4d69a38a55b52ead38698f71ad33b0b692388d85550263962da879d
---
# Review: spec-gate-archived-hint

EGM Goldfish review, consolidated preset (Stages 5-9, one round each, direct dispatch, no `egm-resolve`). Stage reports next to this file: `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`, `intermediate_zoom_out_report.md`, `implementation_readiness_report.md`.

Reviewers: zoom-out ×2, inventive-catalyst, comprehension, design, structural, style ×2, implementation-readiness, codebase-details. All completed; none not run.

Totals: 0 blockers raised by reviewers; one major (IR-9-3) is a blocker in practice, confirmed against the harness code.

## Consolidated actions

| # | Priority | Action | Raw findings |
|---|---|---|---|
| A1 | 🔴 | Tasks must keep every backticked `bun …` Verify command green: the harness runs them and accepts a task only if all exit 0. Merge the red-test task into the implementation task (tests first inside it), and drop the real-repo check task whose commands exit 1. | IR-9-3, IR-9-6, SY-9-4, SY-9-5, SY-9-9, SY-9-10, CD-9-8, CD-9-9, IR-9-10 |
| A2 | 🟡 | Archive match: strip an anchored `YYYY-MM-DD-` prefix and compare the rest to the change name as a plain string; never build a regex from the name; only directory entries count; add a dotted-name test. | DC-7-1, IZ-8-1, IR-9-2, CD-9-5 |
| A3 | 🟡 | Messages: reuse the existing line grammar `<change>: <stage> <reason> (<path>)` with folder-scoped reasons and repo-relative paths without trailing slash; give the literal lines in the design; tests assert those substrings on stderr. Align the spec scenarios' wording. | CO-6-2, IC-5-3, DC-7-4, SY-7-1, IZ-8-3, IR-9-1, CD-9-1, SY-9-3, SY-9-6 |
| A4 | 🟡 | Resolver: one function, private in `src/cli/spec_gate.ts`, that does the I/O; archive read errors are caught inside it and mean "no archive"; reuse `changeDirOf` and the existing constants. Drop "small pure". | ZO-5-1, ZO-5-3, IC-5-1 (downgraded), IC-5-2 (split rejected), DC-7-2, ST-7-4, SY-7-4, SY-7-6, IZ-8-2, IZ-8-5, CD-9-6, IR-9-9 |
| A5 | 🟡 | Keep regression coverage: a test where the folder exists and the stage report is absent still reports `missing`; list all six spec scenarios in the task; mixed-list fixture has a resolved, fresh review. | IR-9-4, CD-9-2, SY-9-1, SY-9-2 |
| A6 | 🟡 | List the files in the task (Modify: `src/cli/spec_gate.ts`, `src/config/constants.ts`, `test/cli/spec_gate.test.ts`, `docs/cli.md`) and update `docs/cli.md` (reasons list and exit-code description); add it to the proposal's Impact. | IR-9-5, CD-9-3, CD-9-4 |
| A7 | 🟢 | "Exists" = a directory at `changeDirOf`; an active folder wins over an archived copy. | CO-6-3, DC-7-3 (first point), IZ-8-4, IR-9-8, SY-7-5 |
| A8 | 🟢 | Design text: one sentence on what `spec-gate check` does; delete the comments-in-function-bodies clause; one clause on why `stamp` is out of scope; fix the `big-thing` example; add `bun run audit` to the final Verify. | CO-6-1, CO-6-7, ST-7-3, SY-7-2, ZO-5-2, DC-7-7, IZ-8-7, SY-7-3, IZ-8-8, IR-9-7 |

## Proposed to decline

| Finding | Reason |
|---|---|
| IC-5-2 reader/classifier split | A second abstraction for about ten lines (IZ-8-2). |
| IC-5-4 near-match and unreadable-archive hints | YAGNI; its author marks it optional. |
| DC-7-3 `--changes archive`, CD-9-7 | Pre-existing behaviour, not hit; out of scope. |
| DC-7-8 case-insensitive APFS | Speculative; names come from the user. |
| CO-6-6 calendar-valid dates | Folders are written by `openspec archive`. |
| DC-7-6, ST-7-1 extra alternatives; ST-7-2 security/scale line | Lengthen the document without changing the build; the proposal already justifies the exit code. |
| CO-6-4, CO-6-5, CO-6-8, CO-6-9, CO-6-10, SY-7-7 glossary items | Answered by the spec scenarios or the proposal, read alongside the design. |
| DC-7-5 stderr consumers | Moot once A3 keeps the line grammar; no in-repo consumer (CD-9 confirmed). |

## Triage

Author decision (2026-11-16): apply A1-A8, decline the list above. Applied through `openspec-update-change`:
- `proposal.md`: example lines in What Changes; `docs/cli.md` added to Impact.
- `specs/spec-gate/spec.md`: exact line format and repo-relative paths; "no change folder" wording; dotted-name scenario; archived copy does not override an existing folder.
- `design.md`: what `spec-gate check` does; one private I/O function with read errors as an empty archive; plain-string archive match on directories; literal message lines; reason for leaving `stamp` and `lint-tasks` out; `big-thing` example fixed; comments clause removed.
- `tasks.md`: file list; tests and implementation merged into task 1.1 (every backticked command is green at the end of the task, as the harness requires); real-repo task removed; `bun run audit` added; docs task 2.1 with a full `bun test`.

Every finding is addressed or declined.
