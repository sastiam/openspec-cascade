# Spec Delta

## Purpose

Keeps an unattended run going when one task needs a human decision or keeps failing: the task is rolled back to its own starting point, recorded in a parked file inside the change, and resumed on a later run once answered.

## ADDED Requirements

### Requirement: Rollback restores the task-start tree
When a task is rolled back, the harness SHALL restore the working tree exactly as it was when that task started. That includes uncommitted work of earlier tasks and untracked files. Files under rollback excludes stay untouched. It SHALL NOT restore the tree to HEAD when HEAD differs from the task start.

#### Scenario: Section-commit mode
- **WHEN** tasks 1.1 and 1.2 of a section passed and are uncommitted, and task 1.3 is rolled back
- **THEN** the work of 1.1 and 1.2 and their checked boxes are still in the tree

#### Scenario: Untracked file from an earlier task
- **WHEN** task 1.1 created an untracked file and task 1.2 is rolled back
- **THEN** the file from 1.1 still exists with its content

### Requirement: Parking switch
Parking SHALL be enabled by `--park`, `--resilient`, `--continue-on-failure`, `CASCADE_RESILIENT` or the file key `resilient`. When parking is off, a `BLOCKED:` reply SHALL stop the run and an exhausted task SHALL stop the run, as before this change.

#### Scenario: Parking off
- **WHEN** parking is off and a task replies `BLOCKED: which region?`
- **THEN** the run stops with a fatal error naming the task, as before

### Requirement: Tasks are parked instead of stopping the run
With parking on, a task whose reply contains a `BLOCKED: <reason>` line SHALL be parked with kind `question`. A task that uses all its attempts SHALL be parked with kind `failure`. Parking SHALL save the task's patch, roll the task back, write the parked file, commit the parked files as `chore(<change>): park <task>`, and continue with the next runnable task.

#### Scenario: Blocked task
- **WHEN** task 2.1 replies `BLOCKED: which AWS region hosts the bucket?`
- **THEN** `openspec/changes/<change>/parked/2.1.md` exists in a commit `chore(<change>): park 2.1`, task 2.1 is unchecked, and the run continues

#### Scenario: Exhausted task
- **WHEN** task 2.1 fails its checks on every attempt
- **THEN** task 2.1 is parked with kind `failure` and the file holds the last verification output

### Requirement: Parked file format
The parked file SHALL start with a header of `key: value` lines between `---` fences. The keys are `format: 1`, `task`, `kind`, `attempts`, `parked-at` and `task-hash`, the hash of the task text. Then comes a section with the full question or the last verification failure, then a final `## Answer` section. The answer is the trimmed text after the `## Answer` heading. Empty means unanswered.

#### Scenario: Answer read
- **WHEN** the parked file ends with `## Answer` followed by `eu-west-1, the bucket is in the shared account`
- **THEN** the task counts as answered with that text

### Requirement: Patch is a hint, never applied
Before the rollback, the harness SHALL save the task's changes since its start as `parked/<task>.patch`. It SHALL leave out the change folder and never-commit paths. An empty diff SHALL produce no patch file. The harness SHALL NOT apply the patch. On resume, it SHALL name the patch path in the prompt.

#### Scenario: Patch excludes the change folder
- **WHEN** the parked task edited `src/a.ts` and `tasks.md`
- **THEN** the patch contains `src/a.ts` and not `tasks.md`

### Requirement: Waiting tasks
With a parked task in a section, the later unchecked tasks of that section SHALL wait. They SHALL NOT run, SHALL NOT get a parked file, and SHALL be reported as waiting on the parked task. Tasks in other sections SHALL continue.

#### Scenario: Section barrier
- **WHEN** task 1.2 is parked and the section has tasks 1.3 and 1.4, and section 2 has task 2.1
- **THEN** 1.3 and 1.4 are reported as waiting on 1.2, and 2.1 runs

### Requirement: Resume on the next run
On a later run with parking on, a parked task with an empty answer SHALL be skipped without starting a session. A parked task with an answer SHALL run with the parked file text appended to its prompt. When a resumed task passes, its parked files SHALL be deleted in that task's commit. A resumed task that parks again SHALL keep the previous question and answer and append a new round.

#### Scenario: Unanswered relaunch
- **WHEN** the run is launched again and `parked/2.1.md` has an empty answer
- **THEN** no session starts for 2.1, it is reported as parked again, and its section's later tasks wait

#### Scenario: Answered relaunch
- **WHEN** the run is launched again and `parked/2.1.md` has an answer
- **THEN** the session prompt for 2.1 contains that answer, and on success `parked/2.1.md` is removed in 2.1's commit
