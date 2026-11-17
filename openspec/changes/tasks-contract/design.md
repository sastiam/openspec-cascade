# Design

## Problem

See [proposal.md](proposal.md). Unchecked tasks in `tasks.md` sometimes ask for work only a human can do (deploy, approve, a console setting). In an unattended run the agent loops on them or checks them off without real verification, and the human work has no place of its own in the change.

## Context

- `lintTasks(markdown)` in `src/sdd/tasks_lint.ts:49` is one line-by-line pass with two rules (`no-code-block`, `missing-verify`). The `flushTask` closure (:54-59) evaluates a finished task block. Lines inside a fence are skipped (:63-66). A block ends at a blank line or a line that is not indented (:76).
- `formatFinding(change, f)` (:87) hard-codes `tasks.md` through `TASKS_LINT_CONSTANTS.FILE_NAME`.
- Constants live in `TASKS_LINT_CONSTANTS` (`src/config/constants.ts:537-556`). `FATAL_HEADER` is `"tasks.md failed lint-tasks; fix these findings before running:"`.
- The CLI is `runLintTasks` in `src/cli/lint_tasks.ts:41`. `lintChange` (:32-36) throws a usage error (exit 2) when `tasks.md` is missing. Findings exit 1.
- Preflight is `lintChanges` in `src/facade/cascade_facade.ts:412-420`. It runs from `preflight()` before the v1/v2 branch, skips dry runs and changes without `tasks.md`, and throws `Fatal` (exit 2).
- Human tasks are matched by `FORMAT_CONSTANTS.HUMAN_TASK_REGEX` (`constants.ts:188`, `/\bopen the PRs?\b|\bdecide the delivery\b|\bgit push\b/i`). The runner tests it against the parsed task text from `parseTasks` (`src/facade/tasks.ts:24`), which keeps backtick spans.
- No span regex constant exists today; `verifyCommands` in `src/facade/tasks.ts:117` inlines `` /`[^`]*`/g ``.
- The v1 final report is built in `execute()` (`cascade_facade.ts:336-344`). v2 builds its own report in `executeV2()` (:357-406).

## Goals / Non-Goals

**Goals:**
- Add `manual-step` to the existing `tasks.md` pass.
- Lint `manual.md` with a second small function.
- List manual steps at the end of a v1 run.
- Rename the preflight header so it fits both files.

**Non-Goals:**
- The v2 pipeline report (`executeV2`). v2 is being deprecated; its report stays unchanged. Preflight still lints both files in v2, because it runs before the mode branch.
- Running `Check:` lines, or collecting evidence.
- Changing the human-task skip behavior of the runner.
- Linting checked tasks.
- Project-specific phrase lists.

## Decisions

- **`manual-step` runs in `flushTask`, on the whole block.**
  - While scanning, the task keeps its block lines: the task line and each continuation line, trimmed. Fenced lines are not part of the block. At flush, the lines are joined with a single space (the raw block).
  - Human-task exemption: if the raw block, with backtick spans kept, matches `HUMAN_TASK_REGEX`, the rule does not fire. This matches the runner, which tests the same regex on text with spans kept. So "Ask the user to run `git push`" is exempt.
  - Phrase match: the raw block with every `TASKS_LINT_CONSTANTS.CODE_SPAN` match (`` /`[^`]*`/g ``, new constant) replaced by a space is tested against `MANUAL_STEP_PATTERNS`. Text in backticks is the documented escape hatch.
  - `MANUAL_STEP_PATTERNS` is a readonly list of regexes with flags `iu`. Each is `(?<![\p{L}\p{N}_])<phrase>(?![\p{L}\p{N}_])`, with the spaces inside a phrase written as `\s+`. `\b` is not used: in JavaScript it treats "ú" as a non-word character, so "ejecuta tú" would never match.
  - The phrases (English): manually, manual step, manual steps, by hand, the user must run, the user must approve, the user should run, ask the user, deploy to staging, deploy to production, deploy to prod, check in the console, set in the console, you must run. (Spanish): manualmente, a mano, el usuario debe, pide al usuario, despliega en, desplegar en, revisa en la consola, configura en la consola, ejecuta tú.
  - Phrases match as listed. There is no stemming: a plural or inflection matches only when it is listed ("manual steps" is listed; "deploys to staging" is not).
  - One finding per task at most, even if several phrases match.
  - `RULE_MANUAL_STEP = "manual-step"`, `MESSAGE_MANUAL_STEP = "task asks for a human action; move it to manual.md or describe the outcome the agent produces (text in backticks is ignored)"`.
- **`lintManual(markdown): TaskFinding[]` is a separate exported function in `tasks_lint.ts`.**
  - It reuses `normalizeLines`, `openingFence` and `closesFence`. Fences are skipped and are not findings in `manual.md`.
  - A step is a top-level list item outside a fence: `MANUAL_STEP_ITEM = /^(?:[-*]|\d+\.)\s+/` at column 0. Its block ends at a blank line or a line that is not indented, as for tasks.
  - `CHECK_LINE = /^\s+(?:[-*]\s+)?Check:\s*\S/`, the same form as `VERIFY_LINE`: indented, optional list marker, case-sensitive, non-empty text.
  - `MANUAL_CHECKBOX = /^(?:[-*]|\d+\.)\s+\[[ xX]\]/`. A checkbox step gives `manual-checkbox`; if it also has no `Check:` line it gives `missing-check` too. Both are on the step line, `manual-checkbox` first (findings are sorted by line with a stable sort, and pushed in that order).
  - New constants: `MANUAL_FILE_NAME = "manual.md"`, `RULE_MISSING_CHECK = "missing-check"`, `RULE_MANUAL_CHECKBOX = "manual-checkbox"`, `MESSAGE_MISSING_CHECK = "step has no indented Check: line with text; add one under the step"`, `MESSAGE_MANUAL_CHECKBOX = "step has a checkbox; remove it so OpenSpec does not count it as a task"`.
- **`parseManualSteps(markdown): {step, check}[]`** lives next to `lintManual` and uses the same step and fence rules. `step` is the item text after the marker and any checkbox, trimmed. `check` is the text after the first `Check:` of the block, trimmed, or `''` when there is none. Steps keep file order.
- **`formatFinding(change, finding, fileName = C.FILE_NAME)`.** Existing callers keep their output.
- **Callers.**
  - `runLintTasks` and `lintChanges` lint `tasks.md` as today, then `manual.md` when it exists, and print a change's `tasks.md` findings before its `manual.md` findings, each in line order, changes in `--changes` order.
  - A missing `manual.md` is not an error. A missing `tasks.md` keeps its current handling (usage error in the CLI, skipped in preflight), and then `manual.md` is not linted.
  - `FATAL_HEADER` becomes `"lint-tasks failed; fix these findings before running:"`.
- **End-of-run listing (v1 only).** In `execute()`, after each change's status line, for each step of that change's `manual.md`, the report gets the line `  manual: <step> — check: <check>` (two leading spaces, an em dash). Not in dry runs, which return earlier. No file is written in this change; `run-outcome` decides where a summary file goes.

## Alternatives Considered

- **Where human steps live.**
  - `manual.md` (chosen): a separate file without checkboxes, so OpenSpec never counts the steps as tasks and archive is not blocked.
  - A marker in `tasks.md` (for example `[human]`): rejected; the task still has a checkbox, so OpenSpec counts it as open.
  - Extending `HUMAN_TASK_REGEX`: rejected; the runner would skip those tasks, but they stay unchecked and open in OpenSpec, and the change never completes.
- **Block or warn.** Block (chosen): a warning in an unattended run is read only after the run has wasted attempts. A false positive fails early in preflight, before any session, and the message gives two fixes.
- **Fixed phrase list or manifest.** Fixed list in constants (chosen): deterministic and testable now. Project phrases can come later through the manifest (`project-manifest`).
- **Separate `lintManual` or a mode flag on `lintTasks`.** Separate function (chosen): the two files have different rules and item shapes; a flag would branch every rule. They share the line and fence helpers.

## Risks / Trade-offs

- [False positive on a legitimate agent task] → Risky phrases are narrowed ("check in the console", not "in the console"; "the user must run", not "the user must"; "deploy to staging", not "deploy to"). The message says how to fix it: move the step to `manual.md`, rephrase as an outcome, or put a literal phrase in backticks.
- [False negative: new phrasing or an unlisted inflection slips through] → The list grows with findings from real runs. The Greptile notes from `run-outcome` are one source.
- [Rollout: in-flight changes whose open tasks use manual phrasing will fail preflight after this merges] → Before merging, run `lint-tasks` over every open change in `openspec/changes/` and fix or move the findings.
- No security or scalability impact: the change only parses local markdown files.
