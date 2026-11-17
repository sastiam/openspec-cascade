# tasks-lint Specification

## Purpose

Keeps a change's `tasks.md` limited to outcomes an agent can do and verify. It rejects code blocks and unchecked tasks without a `Verify:` line before any task runs.

## Requirements

### Requirement: Fenced code blocks are findings
The lint SHALL report one finding, rule `no-code-block`, per fenced code block (three or more backticks or tildes, with any leading whitespace and an optional info string) anywhere in `tasks.md`, at the line that opens it. Inline backtick code SHALL NOT be a finding.

#### Scenario: Backtick fence
- **WHEN** `tasks.md` contains a block opened with three backticks
- **THEN** the lint reports one finding on the opening line

#### Scenario: Fence with an info string
- **WHEN** a block is opened with three backticks followed by a language name
- **THEN** the lint reports one finding on the opening line

#### Scenario: Tilde fence containing backticks
- **WHEN** a block is opened with three tildes and its body has a line of three backticks
- **THEN** the lint reports one finding, not two

#### Scenario: Shorter closer
- **WHEN** a block is opened with four backticks and a line with three backticks appears inside it
- **THEN** the line does not close the block

#### Scenario: Unclosed fence
- **WHEN** a fence is opened and never closed
- **THEN** the lint reports one finding on the opening line

#### Scenario: Inline code
- **WHEN** a `Verify:` line holds a command in single backticks
- **THEN** the lint reports no finding for it

#### Scenario: Three backticks on one line
- **WHEN** a line holds three backticks, text, and three backticks again
- **THEN** the lint treats it as inline code and reports no finding

### Requirement: Every unchecked task needs a Verify line
The lint SHALL report a finding, rule `missing-verify`, for each unchecked top-level task (a `- [ ]` line starting at column 0, with or without an ID) that has no `Verify:` line in its block. Checked tasks (`- [x]` or `- [X]`) SHALL NOT be linted.

#### Scenario: Task with Verify
- **WHEN** an unchecked task is followed by an indented line `Verify: <text>`
- **THEN** the lint reports no finding for that task

#### Scenario: Task without Verify
- **WHEN** an unchecked task has no indented `Verify:` line
- **THEN** the lint reports a finding on the task line

#### Scenario: Task without an ID
- **WHEN** an unchecked task has no ID and no `Verify:` line
- **THEN** the lint reports a finding on the task line

#### Scenario: Checked task
- **WHEN** a task marked `[x]` has no `Verify:` line
- **THEN** the lint reports no finding

### Requirement: Form of the Verify line
A `Verify:` line SHALL be an indented line that starts with `Verify:`, optionally after a `-` or `*` list marker, followed by text. The match SHALL be case-sensitive. A task's block ends at a blank line or a line that is not indented. Lines inside a fenced block SHALL NOT count.

#### Scenario: Task with a list-marked Verify
- **WHEN** an unchecked task is followed by an indented line `- Verify: <text>`
- **THEN** the lint reports no finding for that task

#### Scenario: Verify on the task line
- **WHEN** `Verify:` appears on the task line itself and not on an indented line
- **THEN** the lint reports a finding for the task

#### Scenario: Other spellings
- **WHEN** the only match is lowercase `verify:` or bold `**Verify:**`
- **THEN** the lint reports a finding for the task

#### Scenario: Verify after a blank line
- **WHEN** a `Verify:` line is separated from its task by a blank line
- **THEN** the lint reports a finding for the task, because the task runner does not read that line as part of the task

#### Scenario: Empty Verify
- **WHEN** a task's `Verify:` line has no text after the colon
- **THEN** the lint reports a finding for the task

#### Scenario: Verify inside a fence
- **WHEN** the only `Verify:` line of an unchecked task sits inside a fenced block
- **THEN** the lint reports the `no-code-block` finding and the `missing-verify` finding

### Requirement: Findings are stable and ordered
Each finding SHALL carry a 1-based line number, a stable rule identifier and a one-line message with a fix hint. Findings SHALL be ordered by line. A leading BOM SHALL NOT shift line numbers.

#### Scenario: Ordering
- **WHEN** a file has a fence on line 9 and an unchecked task without `Verify:` on line 3
- **THEN** the finding for line 3 comes first

### Requirement: Task parser and lint agree on line endings
The task parser used to run changes SHALL treat LF, CRLF and CR line endings and a leading BOM the same way, and the lint SHALL report the same findings, with the same line numbers, for the three endings.

#### Scenario: CRLF file
- **WHEN** a `tasks.md` with CRLF endings holds two unchecked tasks
- **THEN** the task parser returns both tasks

#### Scenario: Same findings across endings
- **WHEN** the same file is linted with LF, CRLF and CR endings
- **THEN** the findings are identical

### Requirement: lint-tasks subcommand
The `lint-tasks` subcommand SHALL accept `--changes` (repeated or comma separated) and optional `--repo`, lint `openspec/changes/<change>/tasks.md` for every listed change, then that change's `manual.md` when it exists, and report the findings of all changes, not only the first. When `tasks.md` is missing, `manual.md` SHALL NOT be linted.

#### Scenario: Comma list and repeated flags
- **WHEN** changes are passed once as `a,b` and once as `--changes a --changes b`
- **THEN** both forms lint the same two changes

#### Scenario: Another repository
- **WHEN** `--repo` names a different repository
- **THEN** the command lints the changes of that repository

#### Scenario: Change with manual.md
- **WHEN** a listed change has a `manual.md` with a step without a `Check:` line
- **THEN** the command reports that `missing-check` finding

### Requirement: lint-tasks output and exit codes
The subcommand SHALL print each finding to stderr as `<change>: <file>:<line>: <rule> <message>`, with `<file>` being `tasks.md` or `manual.md`, the `tasks.md` findings of a change before its `manual.md` findings, each in line order. It SHALL print `lint-tasks: ok (<names>)` to stdout when clean, and exit `0` when clean, `1` when either file has findings, `2` for invalid usage. A missing `tasks.md` is invalid usage because the input is required.

#### Scenario: Clean change
- **WHEN** every listed change passes
- **THEN** the command prints the ok line naming the changes and exits 0

#### Scenario: Findings in two changes
- **WHEN** two listed changes have findings
- **THEN** the command prints the findings of both to stderr and exits 1

#### Scenario: Missing tasks.md
- **WHEN** a listed change has no `tasks.md`
- **THEN** the command prints a usage error and exits 2

#### Scenario: Invalid input
- **WHEN** `--changes` is missing, a change name is invalid, or a flag is unknown
- **THEN** the command prints a usage error and exits 2

#### Scenario: Findings in both files
- **WHEN** a listed change has a finding in `tasks.md` and a finding in `manual.md`
- **THEN** the command prints the `tasks.md` line, then the `manual.md` line, and exits 1

#### Scenario: Clean manual.md
- **WHEN** a listed change has a clean `tasks.md` and a clean `manual.md`
- **THEN** the command prints the ok line and exits 0

#### Scenario: No manual.md
- **WHEN** a listed change has one `tasks.md` finding and no `manual.md`
- **THEN** the command prints only that `tasks.md` line and exits 1

### Requirement: Preflight before any engine session
Before any engine session starts, the looper SHALL lint the `tasks.md` and any `manual.md` of every change passed in `--changes`, in every execution mode. On findings it SHALL stop with a fatal error headed `lint-tasks failed; fix these findings before running:`, listing them in the `lint-tasks` line format and order, grouped by change. It SHALL NOT lint changes not passed, nor in dry-run. A missing `tasks.md` is left to the missing-file handling.

#### Scenario: Findings stop the run
- **WHEN** the looper starts and any listed change has a finding
- **THEN** it stops with a fatal error listing the findings and runs no task of any change

#### Scenario: Later change has a finding
- **WHEN** the second listed change has a finding and the first is clean
- **THEN** the run stops before the first change starts

#### Scenario: Second execution mode
- **WHEN** the run uses the v2 pipeline and a listed change has a finding
- **THEN** it stops with the same fatal error

#### Scenario: Dry run
- **WHEN** the run is a dry run and a listed change has a finding
- **THEN** the lint does not run and the dry run prints its plan

#### Scenario: Unlisted change
- **WHEN** a change that was not passed has findings
- **THEN** the run is not affected

#### Scenario: manual.md finding stops the run
- **WHEN** a listed change has a clean `tasks.md` and a `manual.md` step without a `Check:` line
- **THEN** the run stops with the fatal error, whose header is `lint-tasks failed; fix these findings before running:`, and starts no engine session

### Requirement: Manual steps in tasks.md are findings
The lint SHALL report one finding, rule `manual-step`, on the line of each unchecked task whose block text contains a manual-step phrase. The block is the task line plus its continuation lines, each trimmed and joined with a space. Text inside backtick spans SHALL be ignored. The message SHALL tell the author to move the step to `manual.md` and say that text in backticks is ignored. Checked tasks SHALL NOT be linted.

#### Scenario: English manual step
- **WHEN** an unchecked task says "Deploy to staging and confirm the endpoint answers"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Phrase inside a code span
- **WHEN** an unchecked task says "Add the `deploy to staging` label to the help text"
- **THEN** the lint reports no `manual-step` finding

#### Scenario: Phrase on a continuation line
- **WHEN** an unchecked task line says "Publish the release notes" and its indented continuation line says "then deploy to production"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Checked manual step
- **WHEN** a task marked `[x]` says "Deploy to staging"
- **THEN** the lint reports no finding

#### Scenario: Two phrases in one task
- **WHEN** an unchecked task says "Manually deploy to staging"
- **THEN** the lint reports exactly one `manual-step` finding for that task

#### Scenario: Manual step without Verify
- **WHEN** an unchecked task says "Deploy to staging" and has no `Verify:` line
- **THEN** the lint reports `missing-verify` and then `manual-step` on the task line

### Requirement: Manual-step phrase list
Phrases SHALL match case-insensitively and only as whole phrases: the characters before and after a phrase SHALL NOT be a Unicode letter, digit or underscore. Only the listed forms match; a plural or inflection matches only when it is listed. A task whose raw block, with backtick spans kept, matches the human-task pattern ("open the PR", "git push", "decide the delivery") SHALL NOT be a finding.

#### Scenario: English phrases
- **WHEN** an unchecked task contains any of "manually", "manual step", "manual steps", "by hand", "the user must run", "the user must approve", "the user should run", "ask the user", "deploy to staging", "deploy to production", "deploy to prod", "check in the console", "set in the console" or "you must run"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Spanish phrases
- **WHEN** an unchecked task contains any of "manualmente", "a mano", "el usuario debe", "pide al usuario", "despliega en", "desplegar en", "revisa en la consola", "configura en la consola" or "ejecuta tú"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Spanish manual step
- **WHEN** an unchecked task says "El usuario debe aprobar el cambio en la consola"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Non-ASCII phrase before punctuation
- **WHEN** an unchecked task says "Luego ejecuta tú."
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Phrase inside a longer word
- **WHEN** an unchecked task says "Document the redeploy to staging script"
- **THEN** the lint reports no `manual-step` finding

#### Scenario: Narrowed phrases
- **WHEN** an unchecked task says "Print the error in the console", "The user must see an error toast", "The user should see the banner", "Deploy to the docs folder" or "Muestra el error en la consola"
- **THEN** the lint reports no `manual-step` finding

#### Scenario: Unlisted inflection
- **WHEN** an unchecked task says "The script deploys to staging"
- **THEN** the lint reports no `manual-step` finding

#### Scenario: Existing human task
- **WHEN** an unchecked task says "Open the PR"
- **THEN** the lint reports no `manual-step` finding

#### Scenario: Human task inside a code span
- **WHEN** an unchecked task says "Ask the user to run `git push`"
- **THEN** the lint reports no `manual-step` finding, because the raw block with spans kept matches the human-task pattern

### Requirement: manual.md steps need a Check line
When `manual.md` exists in the change folder, the lint SHALL also check it. A step is a top-level list item (`- `, `* ` or `1. ` at column 0) outside fenced blocks. A step whose block has no `Check:` line SHALL be a finding, rule `missing-check`, on the step line. A `Check:` line follows the form rules of the `Verify:` line: indented, optional `-` or `*` marker, case-sensitive, with text. Fenced blocks in `manual.md` SHALL NOT be findings.

#### Scenario: Valid manual.md
- **WHEN** `manual.md` has two steps, each followed by an indented `Check:` line with text
- **THEN** the lint reports no finding for `manual.md`

#### Scenario: Step without Check
- **WHEN** a step in `manual.md` has no `Check:` line
- **THEN** the lint reports a `missing-check` finding on the step line

#### Scenario: Other list markers
- **WHEN** `manual.md` has a step starting with `* ` and a step starting with `1. `, neither with a `Check:` line
- **THEN** the lint reports a `missing-check` finding on each step line

#### Scenario: Check form
- **WHEN** a step's only check is lowercase `check:`, an indented `Check:` with no text, or a `Check:` line after a blank line
- **THEN** the lint reports a `missing-check` finding on the step line

#### Scenario: List item inside a fence
- **WHEN** a list item without a `Check:` line sits inside a fenced block in `manual.md`
- **THEN** the lint reports no finding for it

### Requirement: manual.md has no checkboxes
A step whose text starts with a checkbox (`[ ]`, `[x]` or `[X]` after the list marker) SHALL be a finding, rule `manual-checkbox`, on the step line, so that OpenSpec never counts manual steps as tasks. A checkbox step without a `Check:` line SHALL get both findings, `manual-checkbox` first.

#### Scenario: Checkbox with a Check line
- **WHEN** a step in `manual.md` starts with `- [ ]` and has a `Check:` line
- **THEN** the lint reports only a `manual-checkbox` finding on that line

#### Scenario: Checkbox without a Check line
- **WHEN** a step in `manual.md` starts with `- [x]` and has no `Check:` line
- **THEN** the lint reports a `manual-checkbox` finding and then a `missing-check` finding on that line

### Requirement: Manual steps are listed at the end of a run
At the end of a run in the default (v1) mode that is not a dry run, the final report SHALL list, after the status line of each change that has a `manual.md`, one line per step in file order: `  manual: <step> — check: <check>`. The harness SHALL NOT run the checks. The v2 pipeline report is out of scope and stays unchanged.

#### Scenario: Change with manual steps
- **WHEN** a v1 run finishes a change whose `manual.md` has the step "Approve the release" with check "the release shows Approved"
- **THEN** the final report has the line `  manual: Approve the release — check: the release shows Approved` after that change's status line

#### Scenario: Change without manual.md
- **WHEN** a v1 run finishes a change without `manual.md`
- **THEN** the final report has no `manual:` line for that change
