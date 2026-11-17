# Spec Delta

## Purpose

Runs the Greptile review before the PR, applies only mechanical fixes that pass the checks, and records every finding in the change so recurring problems can be fixed in skills or in cascade.

## ADDED Requirements

### Requirement: Code review after a clean run
When `codeReview.afterRun` is true in `.openspec-cascade.json` and a run exits 0, the harness SHALL run the existing pre-PR review loop against `codeReview.base`, with at most `codeReview.rounds` rounds. When the setting is off or absent, nothing SHALL change. A run that exits 3 SHALL NOT start the review.

#### Scenario: Review off
- **WHEN** `codeReview` is absent from the config
- **THEN** no Greptile review runs after the run

#### Scenario: Run with parked tasks
- **WHEN** `codeReview.afterRun` is true and the run exits 3
- **THEN** no Greptile review runs

### Requirement: Mechanical fixes are checked before commit
When the review loop leaves changes in the tree, the harness SHALL run the `alwaysVerify` and default verify commands. It SHALL commit the changes as `fix: apply Greptile review fixes` only when all checks pass. Otherwise it SHALL restore the tree from before the review and record the failure.

#### Scenario: Fix breaks a check
- **WHEN** a mechanical fix makes a check fail
- **THEN** the fix is not committed, the tree returns to its pre-review state, and `code-review.md` records the failure

### Requirement: code-review.md records every finding
The harness SHALL write `openspec/changes/<change>/code-review.md` for each change in the run. It SHALL contain the review status, the confidence when Greptile reports one, the rounds, and every finding with its category (mechanical, risky, advisory), file and line. It SHALL commit the file as `chore(<change>): record code review`.

#### Scenario: Findings recorded
- **WHEN** the review reports two mechanical findings and one risky finding
- **THEN** `code-review.md` lists all three with their categories, files and lines

### Requirement: Threshold decides the stamp
The harness SHALL stamp `code-review.md` with the spec-gate stage `code-review`. The stamp SHALL be `resolved` when the review status is clean or empty and, if `codeReview.minConfidence` is set, the reported confidence is at least that value. Otherwise it SHALL be `open`. A review with no reported confidence SHALL NOT pass a set threshold.

#### Scenario: Below threshold
- **WHEN** `minConfidence` is 4 and Greptile reports confidence 3 with a clean status
- **THEN** the stamp is `open`
