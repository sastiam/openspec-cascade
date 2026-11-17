# Spec Delta

## Purpose

Runs the Greptile review before the PR in v1 runs, applies only mechanical fixes that pass the checks, and records every finding in the change so recurring problems can be fixed in skills or in cascade. v2 mode is being deprecated and is not covered.

## ADDED Requirements

### Requirement: Code review after a clean run
When `codeReview.afterRun` is true in `.openspec-cascade.json` and a v1 run ends with outcome 0, the harness SHALL run the existing pre-PR review loop against `codeReview.base`, with at most `codeReview.rounds` rounds, after the run summary is committed. `codeReview.afterRun` SHALL be the only switch; the `greptile` config keys SHALL NOT be read by this step. When the setting is off or absent, nothing SHALL change. A run that ends with 1, 2 or 3 SHALL NOT start the review.

#### Scenario: Review off
- **WHEN** `codeReview` is absent from the config
- **THEN** no Greptile review runs after the run

#### Scenario: Run with parked tasks
- **WHEN** `codeReview.afterRun` is true and the run exits 3
- **THEN** no Greptile review runs

### Requirement: codeReview config
`codeReview` SHALL be a strict optional object in the config file with `afterRun` (boolean), `base` (string, default `main`), `rounds` (integer from 1 to `PRE_PR_CONSTANTS.MAX_ROUNDS`, default that maximum) and `minConfidence` (optional number). An unknown key or `rounds` above the maximum SHALL fail to load with exit 2.

#### Scenario: Rounds above the maximum
- **WHEN** the config file has `codeReview.rounds` set to 4 and the maximum is 3
- **THEN** loading the config fails with a config error

### Requirement: Fixer runs inside the run's limits
The review fixer SHALL run through the run's engine, with the run's settings, budget accounting and logging. A budget stop during the review SHALL end the review, restore the pre-review state, and be recorded in `code-review.md`.

#### Scenario: Fixer uses the run engine
- **WHEN** the review reports a mechanical finding and the fixer session runs
- **THEN** the session goes to the run's engine and its cost is added to the run total

### Requirement: Mechanical fixes are checked before commit
Before the review, the harness SHALL record the HEAD SHA and a tree snapshot. When the loop leaves changes, it SHALL run `alwaysVerify` and the default checks (`defaultVerify`, with the same package-manager fallback as task checks) and commit `fix: apply Greptile review fixes` only when all pass. When a check fails, or the fixer made a commit, it SHALL reset to the pre-review HEAD and tree and record why.

#### Scenario: Fix breaks a check
- **WHEN** a mechanical fix makes a check fail
- **THEN** the fix is not committed, HEAD and the tree return to their pre-review state, and `code-review.md` records the failure

#### Scenario: Fixer commits on its own
- **WHEN** the fixer session creates a commit
- **THEN** HEAD is reset to the pre-review SHA, the tree to the pre-review tree, and `code-review.md` records that the fixer committed

### Requirement: Confidence reaches the gate
The Greptile bridge SHALL carry the review's confidence in its result and in its cache. A cached review without a confidence value SHALL count as not reported.

#### Scenario: Cached review without confidence
- **WHEN** the bridge returns a cached review stored before this change, without `confidence`
- **THEN** the confidence is not reported and a set `minConfidence` is not met

### Requirement: code-review.md records every finding
The harness SHALL write `openspec/changes/<change>/code-review.md` for each change in the run, with the review status, the confidence when reported, the rounds, and every finding with its category (mechanical, risky, advisory), file and line. The review covers the whole branch, so every change gets the same content.

#### Scenario: Findings recorded
- **WHEN** the review reports two mechanical findings and one risky finding
- **THEN** `code-review.md` lists all three with their categories, files and lines

#### Scenario: Two changes in the run
- **WHEN** a run covers changes `a` and `b`
- **THEN** both `code-review.md` files hold the same review body

### Requirement: Stamp before commit
The harness SHALL stamp each `code-review.md` with stage `code-review` and the reviewed HEAD, which is the HEAD after the fix commit when there is one, before committing it, then commit it in a single path-limited `chore(<change>): record code review` commit. The tree SHALL be clean after the review step.

#### Scenario: Clean tree after review
- **WHEN** the review step ends
- **THEN** `git status --porcelain` is empty outside `neverCommit` and the workspace excludes (the bridge writes `.cascade/`), and the committed `code-review.md` holds the stamp

### Requirement: Threshold decides the stamp
The stamp SHALL be `resolved` when the review status is clean or empty and, if `codeReview.minConfidence` is set, the reported confidence is at least that value. Otherwise it SHALL be `open`. A review with no reported confidence SHALL NOT pass a set threshold.

#### Scenario: Below threshold
- **WHEN** `minConfidence` is 4 and Greptile reports confidence 3 with a clean status
- **THEN** the stamp is `open`

### Requirement: Review errors do not change the exit code
An error during the review step SHALL be written to `code-review.md`, SHALL leave the stamp `open`, and SHALL NOT change the run's exit code.

#### Scenario: Greptile unavailable
- **WHEN** the Greptile client fails
- **THEN** `code-review.md` records the error, the stamp is `open`, and the process exits 0
