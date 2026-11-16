# Stage 5: Initial Zoom Out Review

Target: `design.md` (full file). Reviewers: `egm-zoom-out` (completed), `egm-inventive-catalyst` (completed). Direct dispatch, one round.

## egm-zoom-out — PASS (0 blockers, 0 majors, 3 nits)

- ZO-5-1 🟢 Decisions, line 19: the resolver is called "pure" but must read the filesystem; the design does not say where it lives. `changeDirOf` already sits in `src/cli/change_args.ts`, shared by `spec-gate` and `lint-tasks`, which have the same misleading message (`spec_gate.ts:79` for stamp, `lint_tasks.ts:34`). Drop "pure" and name the module.
- ZO-5-2 🟢 Non-Goals, line 14: no reason given for leaving `stamp` and `lint-tasks` out. One clause (they fail with exit 2 in interactive use; the motivating failure is `check` in unattended runs) would show the cut is deliberate.
- ZO-5-3 🟢 Risks, line 27: "missing or unreadable" mixes two cases. A missing archive dir is normal; "unreadable" is speculative and swallowing it hides a real problem behind a false "does not exist". Handle only the missing case; let other I/O errors reach the existing top-level catch in `runSpecGate`.

Checked with no finding: exact archive name match, most recent wins, same exit code, altitude of the document.

## egm-inventive-catalyst — no blockers (1 major, 3 nits)

- IC-5-1 🟡 Decisions, line 19 (and Non-Goals line 14): with no stated placement, the resolver will likely become a private helper in `spec_gate.ts`, an architectural dead end for `stamp` and `lint-tasks`. Put it next to `changeDirOf` in `src/cli/change_args.ts`; use it only from `runCheck` now.
- IC-5-2 🟢 Decisions line 19 vs Risks line 27: "pure" yet does I/O. Split into a thin reader (folder exists, archive entries) and a pure classifier (present / archived(name) / unknown) that holds the exact-match and most-recent rules and tests with plain arrays.
- IC-5-3 🟢 Decisions lines 22-23: two free-form message templates break the existing line grammar `<change>: <stage> <reason> (<file>)`. Use `archived` and `unknown` as reason tokens in that same shape so scripts can parse them.
- IC-5-4 🟢 Risks lines 27-28: optional hint on the unknown line when the archive is unreadable or holds a near-match name. Skippable under YAGNI.

Not a false compromise: `evaluateStage` unaware of archives, exact date-prefix match, string sort for latest, exit code 1.

## Overlap

ZO-5-1 and IC-5-1 raise the same placement issue; ZO-5-1 and IC-5-2 the same "pure" wording. ZO-5-3 and IC-5-4 pull in opposite directions on the unreadable-archive case.
