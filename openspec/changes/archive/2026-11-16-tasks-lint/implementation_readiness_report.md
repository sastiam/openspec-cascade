# Goldfish Review Report: Stage 9 (Implementation Readiness)

**Target:** `openspec/changes/tasks-lint/tasks.md` (whole file), standard `implementation-readiness-standard.md`

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

Dispatched directly from the main context, one round, no fixes applied. Severity breakdown after merging duplicates: 2 Blockers, 9 Majors, about 15 Nits. Verdict from the readiness reviewer: not ready, but close. Sequencing and the `Verify:` lines are good; the gaps are in the task text.

## Blocker

### B1. The facade preflight breaks existing tests and no task fixes them - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Tasks 3.3, 3.2, 4.1.
* **Discrepancy Description:** `test/facade/cascade_facade.test.ts` writes `tasks.md` fixtures with no indented `Verify:` line (line 12, line 276), or with `Verify:` on the task line itself (lines 130, 169-170). `test/e2e/helpers/temp_repo.ts:266` also writes a default `tasks.md`. Non-dry-run tests go through `runChange`, so after 3.3 they hit `Fatal`, and the Verify of 3.3 (`bun test test/facade` passes) cannot pass. These files are not listed as targets and no step says how to change the fixtures.
* **Rationale & Recommendation:** Add a task to update those fixtures (add `Verify:` lines, or lint only unchecked tasks as proposed in Stage 8), list the files, and include the e2e helper because `bun test` in 4.1 depends on it.

### B2. No exact file list and no create/modify marking - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness` (1), `egm-codebase-details` (3)
* **Affected Scope:** Whole file, especially tasks 2.4, 3.1, 3.2, 3.3, 3.4.
* **Discrepancy Description:** The standard asks for a repository-relative list of files to create, modify or delete, usable as a write allowlist. Missing: the roadmap path (`docs/superpowers/specs/2026-11-16-cascade-puzzle-roadmap.md`, table row 4 at line 42, section at lines 74-80), the facade test file (presumably `test/facade/cascade_facade.test.ts`), the 29 legacy files (a glob such as `openspec/changes/*/tasks.md` except `tasks-lint`), and the fixture files from B1.
* **Rationale & Recommendation:** Add a Files section with Create, Modify and Untouched lists.

## Major

### M1. The preflight covers only the v1 loop - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (2)
* **Affected Scope:** Tasks 3.3, 3.4, spec "Looper preflight".
* **Description:** `--mode v2` goes to `executeV2` and `v2_pipeline.ts`, which never call `runChange`; dry-run never reaches it either. `cascade-looper.md` documents `--mode v2`. Same finding as Stage 7 B1; the Stage 8 advice (one call before the v1/v2 split) applies. Decide v1-only or a `v2_pipeline.ts` step, and state that dry-run is not linted.

### M2. Task 3.1 is not executable as an ordered step - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (2), `egm-style` (3), `egm-codebase-details` (5, 12)
* **Description:** The repo-wide test has no named file (the Verify implies `test/sdd/tasks_lint.test.ts`), no repo-root resolution, no rule for directories without `tasks.md`, and "other than a new one" cannot be coded: the test must exclude `tasks-lint` by name. BOM and blank-line placement of the marker are undecided. The hardcoded "29" is fragile. Editing files inside this change after stamping also stales the review stamp (not an issue for legacy changes). Stage 8 proposes removing the marker; this finding disappears if that is adopted.

### M3. Task 3.3 leaves the `Fatal` message and the reading helper open - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (3)
* **Description:** The message text is not given (reuse the CLI line format?), nor how `tasks.md` is read, nor whether `facade` importing `sdd` is acceptable. The spec's "SHALL NOT lint changes not passed to it" and the "once per change" claim are not tested (add a call-count assertion).

### M4. Task 1.3 leaves the rule algorithm to the implementer - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (4), `egm-style` (nit 3)
* **Description:** Rule IDs, the heading pattern, the fence opener pattern (info strings such as a language tag, closer with trailing text), the finding line for each rule, and message wording with fix hints are not in the task. Tests cannot be written without them, or must not match on message text. Point to a design section by number or restate the definitions; the tasks file should stand alone.

### M5. Task 1.2 is a list of cases, not test cases - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (5), `egm-style` (1)
* **Description:** About 22 scenarios in one sentence with no expected findings. Missing cases: indented fence opener, closer shorter than opener, `*` and `-` Verify markers, bold `**Verify:**`, `Verify:` on the task line, lowercase `verify:`, uppercase `[X]`, task without an ID, tab-indented Verify, `Verify inside a fence` (two findings), plus tests for `hasSkipMarker` (first line only, BOM, line 2, whitespace). Replace with a table of input and expected `{line, rule}`.

### M6. The line-ending cases and the agreement test disagree with `parseTasks` - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (4)
* **Description:** Same as Stage 5 M2 and Stage 7 M3. `parseTasks` splits only on `\n`, so a CRLF task is invisible to it and the agreement test in 1.4 cannot hold for CRLF or CR. Say the test runs on LF only, or fix `parseTasks` (the Stage 8 recommendation). A column-0 `# ` line still ends a block because it is non-indented; say so in the test comment. Also name the `parseTasks` import in 1.4 and state the expected behavior for ID-less tasks.

### M7. Tasks 2.1 to 2.4 leave names and observable details open - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (7, 8, 9, 10), `egm-codebase-details` (10)
* **Description:** No function names or signatures for `change_args.ts`, no name for the shared error class, no statement of where `SpecGateOutput` lives, the `--repo` default, dedupe of repeated names, the exact ok-line text for a mix of clean and skipped changes, output order for several changes, or whether `test/cli/commands.test.ts` needs new cases. The docs row and the README section receiving `cascade.ts lint-tasks` are not described, and no test checks the exit 2 note.

### M8. The suite is red between 2.3 and 2.4, and between 3.2 and 3.3 - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (6), `egm-implementation-readiness` (13)
* **Description:** After 2.3 adds `lint-tasks` to `SUBCOMMANDS`, `test/docs/cli_docs.test.ts` fails until 2.4 adds the docs. The standard requires every phase to end buildable and testable. Merge the docs into 2.3, or reorder. State that 3.2 and 3.3 land together, or that red is expected between them.

### M9. Docs tasks 2.4 and 3.4 are underspecified and weakly verified - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (7, nit 8), `egm-implementation-readiness` (11), `egm-style` (8)
* **Description:** The roadmap edit has no exact wording and no test reads the roadmap. `test/plugin` contains only `egm_commands.test.ts`; nothing tests `cascade-looper.md`. The sentence to add to `docs/cli.md` line 142 and to `cascade-looper.md` is not given. Give the target section and required facts, or accept the step as unverified. Two edits to `docs/cli.md` (2.4 and 3.4) should be stated as different sections.

### M10. Task 1.1 is open-ended and its Verify is weak - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (6), `egm-style` (2), `egm-codebase-details` (9)
* **Description:** "No magic numbers or strings left" is an absolute claim that `bun run typecheck` cannot show. The constants list gives no values (skip-marker string, rule IDs, message wording). Reword to "reads patterns, IDs and messages from `TASKS_LINT_CONSTANTS`", restate the values, and use a Verify that can fail.

### M11. Task 4.1 duplicates earlier verifies and first runs `bun run lint` - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (12), `egm-style` (4, nit 9)
* **Description:** Lint failures can first surface in the last task with no fix step; run `bun run lint` in each code task. "The lint" is ambiguous between `bun run lint` and `lint-tasks`; list the Verify commands separately.

## Nits

* Task 1.2: "fixtures from string arrays because they contain backticks" has an unclear antecedent; "the same lines as LF" should read "the same findings"; drop the redundant "first".
* Task 1.3: restates design detail ("scan fence state once, then one function per rule"); keep the outcome.
* Task 1.4: a double-negative sentence; split into two checks.
* Task 2.4: three docs edits and a roadmap edit in one task; the Spanish parenthetical is a mid-sentence aside.
* Use one name for the line base ("1-based lines" versus "line number base").
* The facade test in 3.2 does not say how it builds a repo fixture; it can reuse `addOpenSpecChange`.
* The agreement test (1.4) and the spec's `--changes` repeated-versus-comma and "ok line names the changes" scenarios have no matching case in 2.2.

## What is already good
* Test-first ordering in both phases with an expected failure reason in each `Verify:`.
* Every task has an indented `Verify:` line with no fences, so the file passes its own rules.
* The package scripts, the `cascade.ts` dispatch, `commands.ts` exhaustive switch and the named source files all exist; nothing in the repo overlaps with the new files; the count of 29 legacy files is right.
