# Design

## Context

`lintTasks(markdown)` in `src/sdd/tasks_lint.ts:49` is one line-by-line pass with two hard-coded rules (`no-code-block`, `missing-verify`). The `flushTask` closure (:54-59) evaluates a finished task block. `formatFinding(change, f)` (:87) hard-codes `tasks.md` in the line. Constants live in `TASKS_LINT_CONSTANTS` (`src/config/constants.ts:537-556`). The CLI is `runLintTasks` in `src/cli/lint_tasks.ts:41`. Preflight is `lintChanges` in `src/facade/cascade_facade.ts:412-420`, and it throws `Fatal`. Human tasks are matched by `FORMAT_CONSTANTS.HUMAN_TASK_REGEX` (`constants.ts:188`). The final report is built in `execute()` (`cascade_facade.ts:336-344`).

## Goals / Non-Goals

**Goals:**
- Add `manual-step` to the existing pass.
- Lint `manual.md` with a second small function.
- List manual steps at the end of a run.

**Non-Goals:**
- Running `Check:` lines, or collecting evidence.
- Changing the human-task skip behavior.
- Linting checked tasks.

## Decisions

- **`manual-step` runs in `flushTask`, on the whole block.**
  - The block text is collected while scanning. Backtick spans are removed with the same span regex the verification code uses.
  - The result is matched against `TASKS_LINT_CONSTANTS.MANUAL_STEP_PATTERNS`: a readonly list of case-insensitive regexes with word boundaries.
  - A block that matches `HUMAN_TASK_REGEX` is exempt.
  - One finding per task at most, even if several phrases match.
  - Alternative considered: a free-form denylist of the single word "deploy". Rejected: "Document the deploy workflow" is a valid agent task. Phrases like "deploy to" carry the intent.
- **`lintManual(markdown): TaskFinding[]` is a separate exported function in `tasks_lint.ts`.**
  - It reuses `normalizeLines` and the fence handling.
  - It returns findings with the same `TaskFinding` shape.
  - `formatFinding` gains a file-name parameter that defaults to `tasks.md`, so existing callers keep their output.
- **Callers read `manual.md` only if it exists.**
  - `runLintTasks` and `lintChanges` lint `tasks.md` as today, then `manual.md` when present.
  - They print findings in file order: tasks first, then manual.
  - A missing `manual.md` is not an error, while a missing `tasks.md` keeps its current handling.
- **Manual steps for the report come from a pure parser.** `parseManualSteps(markdown): {step, check}[]` lives in `tasks_lint.ts`, next to the linter, so both read the same format. `execute()` calls it for each finished change and appends the lines after the change's status line. No file is written in this change; `run-outcome` decides where the summary file goes.
- **The phrase list is in constants, not in config.** Project-specific phrases can come later through the manifest (`project-manifest`). Keeping the list fixed now keeps the rule deterministic and testable.

## Risks / Trade-offs

- [False positive on a legitimate agent task] → The message says how to fix it: move the step to `manual.md`, or rephrase so the task describes the outcome the agent produces. A wrong match blocks preflight, and fails early, which is the intended trade-off.
- [False negative: new phrasing slips through] → The list grows with new findings from real runs. The Greptile notes from `run-outcome` are one source.
