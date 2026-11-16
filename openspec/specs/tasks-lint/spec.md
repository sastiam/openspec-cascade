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
The `lint-tasks` subcommand SHALL accept `--changes` (repeated or comma separated) and optional `--repo`, lint `openspec/changes/<change>/tasks.md` for every listed change, and report the findings of all changes, not only the first.

#### Scenario: Comma list and repeated flags
- **WHEN** changes are passed once as `a,b` and once as `--changes a --changes b`
- **THEN** both forms lint the same two changes

#### Scenario: Another repository
- **WHEN** `--repo` names a different repository
- **THEN** the command lints the changes of that repository

### Requirement: lint-tasks output and exit codes
The subcommand SHALL print each finding to stderr as `<change>: tasks.md:<line>: <rule> <message>`, print `lint-tasks: ok (<names>)` to stdout when clean, and exit `0` when clean, `1` when there are findings, `2` for invalid usage. A missing `tasks.md` is invalid usage because the input is required.

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

### Requirement: Preflight before any engine session
Before any engine session starts, the looper SHALL lint the `tasks.md` of every change passed in `--changes`, in every execution mode, and when there are findings SHALL stop with a fatal error listing them in the `lint-tasks` line format, grouped by change. It SHALL NOT lint changes that were not passed. It SHALL NOT lint in dry-run. A listed change with no `tasks.md` is reported by the existing missing-file handling, not by the lint.

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
