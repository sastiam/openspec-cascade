# Spec Delta

## Purpose

Keeps an unattended v1 run going when one task needs a human decision or keeps failing: the task is rolled back to its own starting point, recorded in a parked file inside the change, and resumed on a later run once answered. v2 mode is being deprecated and is not covered.

## ADDED Requirements

### Requirement: Rollback restores the task-start tree
When a v1 task is rolled back, the harness SHALL restore the working tree as it was when that task started, including uncommitted work of earlier tasks, untracked files and files deleted before the task. Untracked paths in the rollback excludes SHALL stay untouched. Tracked files SHALL be reverted as today, excluded or not. It SHALL NOT restore the tree to HEAD when HEAD differs from the task start.

#### Scenario: Section-commit mode
- **WHEN** tasks 1.1 and 1.2 of a section passed and are uncommitted, and task 1.3 is rolled back
- **THEN** the work of 1.1 and 1.2 and their checked boxes are still in the tree

#### Scenario: Untracked file from an earlier task
- **WHEN** task 1.1 created an untracked file and task 1.2 is rolled back
- **THEN** the file from 1.1 still exists with its content

#### Scenario: File deleted by an earlier task stays deleted
- **WHEN** task 1.1 deleted the tracked file `src/old.ts` without committing, and task 1.2 is rolled back
- **THEN** `src/old.ts` does not exist in the working tree

#### Scenario: Untracked excluded path survives
- **WHEN** the untracked never-commit file `.atl` exists before task 1.2 and is changed during it, and task 1.2 is rolled back
- **THEN** `.atl` still exists with its changed content

### Requirement: Tree restore is opt-in in the shared rollback buffer
The tree snapshot and restore SHALL run only when the buffer is created with `restoreTree: true`, which only the v1 facade sets. Without it, and when `rollback` gets an explicit target ref, the buffer SHALL behave as before this change. A failed tree capture SHALL be logged as a hook event and fall back to a HEAD-only rollback, SHALL NOT throw, and SHALL add no audit entry.

#### Scenario: Other buffer users unchanged
- **WHEN** a buffer is created without `restoreTree` and rolled back
- **THEN** it runs only the reset and clean commands it ran before this change, and its audit trail is unchanged

#### Scenario: Tree capture fails
- **WHEN** the tree capture fails during a snapshot with `restoreTree: true`
- **THEN** the snapshot returns the HEAD SHA, a `rollback_tree_snapshot_failed` event is logged, and a later rollback resets to HEAD only

### Requirement: Snapshot leaves no trace
The tree snapshot SHALL use a temporary index file with a unique name in a temporary directory, seeded from HEAD, and SHALL remove it when the snapshot ends, also on failure. The snapshot SHALL NOT change the real index, the working tree or any ref, and SHALL NOT create a commit.

#### Scenario: Temporary index removed
- **WHEN** a snapshot is taken
- **THEN** no temporary index file remains, no ref was added, and `git status` output is unchanged

### Requirement: Failed rollback stops the run
When a v1 rollback fails, the harness SHALL stop the run with a `RollbackFailedError`, which is fail-closed and exits 2, with parking on or off.

#### Scenario: Rollback fails
- **WHEN** a task is rolled back while `.git/index.lock` exists
- **THEN** the run stops with `RollbackFailedError` and exits 2

### Requirement: Parking switch
Parking SHALL be enabled by `--park`, `--resilient`, `--continue-on-failure`, `CASCADE_RESILIENT`, `CASCADE_CONTINUE_ON_FAILURE` or the file key `resilient`. When parking is off, a `BLOCKED:` reply and an exhausted task SHALL stop the run as before this change. Parking applies to v1 runs only.

#### Scenario: Parking off
- **WHEN** parking is off and a task replies `BLOCKED: which region?`
- **THEN** the run stops with a fatal error naming the task, as before

### Requirement: Parking requires rollback
When parking is on and rollback on failure is off (`--no-rollback`, `CASCADE_ROLLBACK_ON_FAILURE=false`, `CASCADE_GIT_ROLLBACK=false` or the file key `rollbackOnFailure: false`), loading the config SHALL fail with a config error and the process SHALL exit 2 before any session starts.

#### Scenario: Park with no rollback
- **WHEN** the run is started with `--park --no-rollback`
- **THEN** it exits 2 with a config error naming both settings and starts no session

#### Scenario: Park with rollback off from the environment
- **WHEN** the config is loaded with `CASCADE_CONTINUE_ON_FAILURE=true` and `CASCADE_GIT_ROLLBACK=false`
- **THEN** loading fails with a config error

### Requirement: Tasks are parked instead of stopping the run
With parking on, a task whose reply contains a `BLOCKED: <reason>` line SHALL be parked with kind `question`. A task that uses all its attempts SHALL be parked with kind `failure`. After parking, the harness SHALL continue with the next runnable task.

#### Scenario: Blocked task
- **WHEN** task 2.1 replies `BLOCKED: which AWS region hosts the bucket?`
- **THEN** `openspec/changes/<change>/parked/2.1.md` exists in a commit `chore(<change>): park 2.1`, task 2.1 is unchecked, and the run continues

#### Scenario: Exhausted task
- **WHEN** task 2.1 fails its checks on every attempt
- **THEN** task 2.1 is parked with kind `failure` and the file holds the raw output of the last verification, headed by the command and its exit code

#### Scenario: Failure without verification output
- **WHEN** task 2.1 has a Verify line naming no command, `defaultVerify` is empty, and every session ends without checking the task
- **THEN** the parked file holds the last session result, or the session error reason when there is no result

### Requirement: Order of parking steps
Parking SHALL capture the patch in memory, roll the task back, commit any remaining uncommitted work, write the parked file and the patch file, and commit only those files as `chore(<change>): park <task>`, in that order.

#### Scenario: Parked files survive later rollbacks
- **WHEN** task 2.1 is parked and task 3.1 is rolled back later in the same run
- **THEN** `parked/2.1.md` is still in HEAD and in the working tree

### Requirement: Partial commit of earlier work
When a task parks and the tree after rollback differs from HEAD outside the excludes and the change's `parked/` folder, the harness SHALL first commit that work as `chore(<change>): <section title> (partial, <task> parked)`, cut to the commit message limit. The next run SHALL start with a clean tree.

#### Scenario: Section mode with a parked task
- **WHEN** in section-commit mode 1.1 passes, 1.2 parks, and 2.1 runs and its section commits
- **THEN** HEAD history holds a partial commit with the work of 1.1, then the park commit of 1.2, then a section 2 commit with no section 1 files, and a second run passes the dirty-tree preflight

### Requirement: Path-limited harness commits
Every commit the harness makes for parked files, `run-summary.md` or `code-review.md` SHALL stage and commit only those paths (`git add -- <paths>` and `git commit -- <paths>`, or `git rm -- <paths>` for removals). It SHALL NOT use `git add -A` for them.

#### Scenario: Park commit holds only parked files
- **WHEN** task 2.1 is parked while the untracked never-commit file `.atl` exists
- **THEN** the park commit lists only files under `openspec/changes/<change>/parked/`, and `.atl` stays untracked with its content

### Requirement: Parked file header
The parked file SHALL start with `key: value` lines between `---` fences: `format: 1`, `task`, `kind`, `task-hash`, `attempts`, `parked-at` and `rounds`. `task-hash` SHALL be the sha256 of the task text as returned by `parseTasks`. `kind`, `attempts` and `parked-at` SHALL describe the latest round. Dates SHALL be ISO 8601 UTC with seconds and `Z`.

#### Scenario: Header written
- **WHEN** task 2.1 is parked for the first time with kind `question` after 1 attempt
- **THEN** the header has `format: 1`, `task: 2.1`, `kind: question`, `attempts: 1`, `rounds: 1` and the sha256 of the task text

### Requirement: Parked file rounds and answer
After the header, the file SHALL hold one `## Round <n> (<kind>, <date>)` section per park, starting with a `patch:` line and a `left-out:` line, then the full question or failure, and end with a `## Answer` section. The answer is the trimmed text after the last `## Answer` heading; empty or whitespace-only means unanswered. A new round SHALL move the previous answer into its round as `### Answer` and leave `## Answer` empty.

#### Scenario: Two-round example
- **WHEN** task 2.1 was parked on 2026-11-16 with the question `which AWS region hosts the bucket?`, answered `eu-west-1`, and failed all 3 attempts on 2026-11-17
- **THEN** the file holds, in order: the header with `kind: failure`, `attempts: 3`, `parked-at: 2026-11-17T03:10:00Z` and `rounds: 2`; `## Round 1 (question, 2026-11-16T02:40:00Z)` with `patch: none`, `left-out: none` and the question; `### Answer` with `eu-west-1`; `## Round 2 (failure, 2026-11-17T03:10:00Z)` with `patch: parked/2.1.patch`, `left-out: none` and the last verification output; and an empty `## Answer`

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
The failure text SHALL be the raw output of each failed check headed by its command and exit code, else the last session result, else the session error reason. It SHALL be capped at `PARK_CONSTANTS.FAILURE_MAX_CHARS` (20000) characters, keeping the last characters, with the note `Output truncated to the last 20000 characters.` when the cap applies. It SHALL never come from the run log.

#### Scenario: Long failure output
- **WHEN** the last verification output has 50000 characters
- **THEN** the round holds its last 20000 characters and the truncation note

### Requirement: Patch is a hint, never applied
Before the rollback, the harness SHALL compute the task's changes since its start in memory, with binary support, leaving out the change folder and the rollback excludes. After the rollback it SHALL write them as `parked/<task>.patch`. An empty diff SHALL produce no patch file. The harness SHALL NOT apply the patch. On resume, it SHALL name the patch path in the prompt.

#### Scenario: Patch excludes the change folder
- **WHEN** the parked task edited `src/a.ts` and `tasks.md`
- **THEN** the patch contains `src/a.ts` and not `tasks.md`

#### Scenario: Untracked new file included
- **WHEN** the parked task created the untracked file `src/b.ts`
- **THEN** the patch contains `src/b.ts`

### Requirement: Secret-looking paths stay out of patches
The patch SHALL leave out every path matching `.env*`, `*.pem`, `*.key` or `*.p12` at any depth, and the parked round SHALL list those paths by name only on its `left-out:` line. Rollback-excluded paths, including `neverCommit`, are never captured and are not listed. This rule is interim until `autonomy-guard`.

#### Scenario: Env file left out
- **WHEN** the parked task changed `src/a.ts` and created `.env.local` and `config/.env.test`
- **THEN** the patch contains `src/a.ts` only, and the round's `left-out:` line lists `.env.local` and `config/.env.test`

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

### Requirement: Answers need no commit
Preflight SHALL accept uncommitted edits under `openspec/changes/<change>/parked/` of each listed change, as it accepts `neverCommit` paths, so the user can answer by editing the file without committing.

#### Scenario: Uncommitted answer
- **WHEN** the user typed an answer in `parked/2.1.md` without committing and starts the run without `--allow-dirty`
- **THEN** preflight passes

### Requirement: Resume on the next run
On a later run with parking on, a parked task with an empty answer SHALL be skipped without starting a session. A parked task with an answer SHALL run with a resume block holding the parked file text and the patch path appended to its prompt. When it passes, its parked files SHALL be deleted and the deletion SHALL be in the commit that holds its work.

#### Scenario: Unanswered relaunch
- **WHEN** the run is launched again and `parked/2.1.md` has an empty answer
- **THEN** no session starts for 2.1, it is reported as parked again, and its section's later tasks wait

#### Scenario: Answered relaunch
- **WHEN** the run is launched again and `parked/2.1.md` has an answer
- **THEN** the session prompt for 2.1 contains that answer, and on success `parked/2.1.md` is removed in the commit that holds 2.1's work

#### Scenario: Resumed task parks again
- **WHEN** an answered task 2.1 fails again on every attempt
- **THEN** `parked/2.1.md` gains round 2 and keeps round 1 with its answer
