# Spec Delta

## Purpose

Keeps an unattended v1 run going when one task needs a human decision or keeps failing: the task is rolled back to its own starting point, recorded in a parked file inside the change, and resumed on a later run once answered. v2 mode is being deprecated and is not covered.

## ADDED Requirements

### Requirement: Rollback restores the task-start tree
When a task is rolled back, the harness SHALL restore the working tree exactly as it was when that task started, including uncommitted work of earlier tasks, untracked files and files deleted before the task. Paths in the rollback excludes SHALL stay untouched. It SHALL NOT restore the tree to HEAD when HEAD differs from the task start.

#### Scenario: Section-commit mode
- **WHEN** tasks 1.1 and 1.2 of a section passed and are uncommitted, and task 1.3 is rolled back
- **THEN** the work of 1.1 and 1.2 and their checked boxes are still in the tree

#### Scenario: Untracked file from an earlier task
- **WHEN** task 1.1 created an untracked file and task 1.2 is rolled back
- **THEN** the file from 1.1 still exists with its content

#### Scenario: File deleted by an earlier task stays deleted
- **WHEN** task 1.1 deleted the tracked file `src/old.ts` without committing, and task 1.2 is rolled back
- **THEN** `src/old.ts` does not exist in the working tree

### Requirement: Snapshot leaves no trace
The tree snapshot SHALL use a temporary index file under the git directory with a unique name, seeded from HEAD. The temporary index SHALL be removed when the snapshot ends, also on failure. The snapshot SHALL NOT change the real index, the working tree or any ref.

#### Scenario: Temporary index removed
- **WHEN** a snapshot is taken
- **THEN** no temporary index file remains in the git directory and `git status` output is unchanged

### Requirement: Parking switch
Parking SHALL be enabled by `--park`, `--resilient`, `--continue-on-failure`, `CASCADE_RESILIENT`, `CASCADE_CONTINUE_ON_FAILURE` or the file key `resilient`. When parking is off, a `BLOCKED:` reply and an exhausted task SHALL stop the run as before this change. Parking applies to v1 runs only.

#### Scenario: Parking off
- **WHEN** parking is off and a task replies `BLOCKED: which region?`
- **THEN** the run stops with a fatal error naming the task, as before

### Requirement: Parking requires rollback
When parking is on and rollback on failure is off (`--no-rollback`, `CASCADE_ROLLBACK_ON_FAILURE=false` or the file key `rollbackOnFailure: false`), loading the config SHALL fail with a config error and the process SHALL exit 2 before any session starts.

#### Scenario: Park with no rollback
- **WHEN** the run is started with `--park --no-rollback`
- **THEN** it exits 2 with a config error naming both settings and starts no session

### Requirement: Tasks are parked instead of stopping the run
With parking on, a task whose reply contains a `BLOCKED: <reason>` line SHALL be parked with kind `question`. A task that uses all its attempts SHALL be parked with kind `failure`. After parking, the harness SHALL continue with the next runnable task.

#### Scenario: Blocked task
- **WHEN** task 2.1 replies `BLOCKED: which AWS region hosts the bucket?`
- **THEN** `openspec/changes/<change>/parked/2.1.md` exists in a commit `chore(<change>): park 2.1`, task 2.1 is unchecked, and the run continues

#### Scenario: Exhausted task
- **WHEN** task 2.1 fails its checks on every attempt
- **THEN** task 2.1 is parked with kind `failure` and the file holds the last verification output

#### Scenario: Failure without verification output
- **WHEN** task 2.1 has no Verify line and every session ends without checking the task
- **THEN** the parked file holds the last session result, or the session error reason when there is no result

### Requirement: Order of parking steps
Parking SHALL capture the patch, roll the task back, commit any remaining uncommitted work, write the parked files, and commit only the parked files as `chore(<change>): park <task>`, in that order.

#### Scenario: Parked files survive later rollbacks
- **WHEN** task 2.1 is parked and task 3.1 is rolled back later in the same run
- **THEN** `parked/2.1.md` is still in HEAD and in the working tree

### Requirement: Partial commit of earlier work
When a task parks and the tree after rollback differs from HEAD, the harness SHALL first commit that work as `chore(<change>): <section title> (partial, <task> parked)`. This holds the verified but uncommitted work of earlier tasks. The next run SHALL start with a clean tree.

#### Scenario: Section mode with a parked task
- **WHEN** in section-commit mode 1.1 passes, 1.2 parks, and 2.1 runs and its section commits
- **THEN** HEAD history holds a partial commit with the work of 1.1, then the park commit of 1.2, then a section 2 commit with no section 1 files, and a second run passes the dirty-tree preflight

### Requirement: Path-limited harness commits
Every commit the harness makes for parked files, `run-summary.md` or `code-review.md` SHALL stage and commit only those paths (`git add -- <paths>` and `git commit -- <paths>`, or `git rm -- <paths>` for removals). It SHALL NOT use `git add -A` for them.

#### Scenario: Park commit holds only parked files
- **WHEN** task 2.1 is parked while the never-commit file `.atl` is modified
- **THEN** the park commit lists only files under `openspec/changes/<change>/parked/`, and `.atl` stays modified and uncommitted

### Requirement: Parked file header
The parked file SHALL start with `key: value` lines between `---` fences: `format: 1`, `task`, `kind`, `task-hash`, `attempts`, `parked-at` and `rounds`. `task-hash` SHALL be the sha256 of the task text as returned by `parseTasks`. `kind`, `attempts` and `parked-at` SHALL describe the latest round.

#### Scenario: Header written
- **WHEN** task 2.1 is parked for the first time with kind `question` after 1 attempt
- **THEN** the header has `format: 1`, `task: 2.1`, `kind: question`, `attempts: 1`, `rounds: 1` and the sha256 of the task text

### Requirement: Parked file rounds and answer
After the header, the file SHALL hold one `## Round <n> (<kind>, <date>)` section per park, with the full question or failure, and end with a `## Answer` section. The answer is the trimmed text after the last `## Answer` heading; empty or whitespace-only means unanswered. A new round SHALL move the previous answer into its round as `### Answer` and leave `## Answer` empty.

#### Scenario: Two-round example
- **WHEN** task 2.1 was parked on 2026-11-16 with the question `which AWS region hosts the bucket?`, answered `eu-west-1`, and failed all 3 attempts on 2026-11-17
- **THEN** the file holds, in order: the header with `kind: failure`, `attempts: 3`, `parked-at: 2026-11-17T03:10:00Z` and `rounds: 2`; `## Round 1 (question, 2026-11-16T02:40:00Z)` with the question; `### Answer` with `eu-west-1`; `## Round 2 (failure, 2026-11-17T03:10:00Z)` with the last verification output; and an empty `## Answer`

#### Scenario: Answer read
- **WHEN** the parked file ends with `## Answer` followed by `eu-west-1, the bucket is in the shared account`
- **THEN** the task counts as answered with that text

#### Scenario: Whitespace answer
- **WHEN** the `## Answer` section holds only spaces and blank lines
- **THEN** the task counts as unanswered

#### Scenario: Second round keeps the first
- **WHEN** an answered task parks again
- **THEN** the file has rounds 1 and 2, round 1 keeps its question and its answer under `### Answer`, and the final `## Answer` is empty

### Requirement: Failure text cap
The failure text SHALL be capped at `PARK_CONSTANTS.FAILURE_MAX_CHARS` (20000) characters, keeping the last characters. When the cap applies, the round SHALL include the note `Output truncated to the last 20000 characters.` The text SHALL come from the session result and verification output, never from the run log.

#### Scenario: Long failure output
- **WHEN** the last verification output has 50000 characters
- **THEN** the round holds its last 20000 characters and the truncation note

### Requirement: Patch is a hint, never applied
Before the rollback, the harness SHALL save the task's changes since its start as `parked/<task>.patch`, with binary support. It SHALL leave out the change folder and the rollback excludes. An empty diff SHALL produce no patch file. The harness SHALL NOT apply the patch. On resume, it SHALL name the patch path in the prompt.

#### Scenario: Patch excludes the change folder
- **WHEN** the parked task edited `src/a.ts` and `tasks.md`
- **THEN** the patch contains `src/a.ts` and not `tasks.md`

### Requirement: Secret-looking paths stay out of patches
The patch SHALL leave out every path matching `.env*`, `*.pem`, `*.key`, `*.p12` or `neverCommit`. The parked file SHALL list those paths by name only, without content. This rule is interim until `autonomy-guard`.

#### Scenario: Env file left out
- **WHEN** the parked task changed `src/a.ts` and created `.env.local`
- **THEN** the patch contains `src/a.ts` only, and the parked file lists `.env.local` as left out

### Requirement: Waiting tasks
With an unchecked parked task in a section, the later unchecked tasks of that section SHALL wait. They SHALL NOT run, SHALL NOT get a parked file, and SHALL be reported as waiting on the parked task. Tasks in other sections SHALL continue.

#### Scenario: Section barrier
- **WHEN** task 1.2 is parked and the section has tasks 1.3 and 1.4, and section 2 has task 2.1
- **THEN** 1.3 and 1.4 are reported as waiting on 1.2, and 2.1 runs

### Requirement: Stale parked files
A parked file SHALL be stale when its task id is missing from `tasks.md`, the task is checked, or its `task-hash` differs from the current task text. A stale file SHALL be ignored for scheduling, SHALL be reported as stale in the run summary and in `status`, and SHALL never make a task skip or wait.

#### Scenario: Task text edited
- **WHEN** `parked/2.1.md` has an empty answer and the text of task 2.1 was edited since parking
- **THEN** task 2.1 runs normally and the file is reported as stale

### Requirement: Relaunch report
At the start of each change, the harness SHALL print one line per parked file: `<task>: answered`, `<task>: waiting for answer` or `<task>: stale (<reason>)`.

#### Scenario: Mixed parked files
- **WHEN** a change has an answered `parked/1.2.md` and an unanswered `parked/2.1.md`
- **THEN** the run prints `1.2: answered` and `2.1: waiting for answer` before any session

### Requirement: Resume on the next run
On a later run with parking on, a parked task with an empty answer SHALL be skipped without starting a session. A parked task with an answer SHALL run with the parked file text and patch path appended to its prompt. When it passes, its parked files SHALL be removed in the commit that holds its work.

#### Scenario: Unanswered relaunch
- **WHEN** the run is launched again and `parked/2.1.md` has an empty answer
- **THEN** no session starts for 2.1, it is reported as parked again, and its section's later tasks wait

#### Scenario: Answered relaunch
- **WHEN** the run is launched again and `parked/2.1.md` has an answer
- **THEN** the session prompt for 2.1 contains that answer, and on success `parked/2.1.md` is removed in the commit that holds 2.1's work

#### Scenario: Resumed task parks again
- **WHEN** an answered task 2.1 fails again on every attempt
- **THEN** `parked/2.1.md` gains round 2 and keeps round 1 with its answer
