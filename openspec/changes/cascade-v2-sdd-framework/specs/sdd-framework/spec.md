# Spec: Cascade v2 Spec-Driven Development Framework

## ADDED Requirements

### Requirement: PreToolUse SDD Gate Enforcement
The system MUST prevent modification of production source files when no active, valid OpenSpec change exists with pending tasks.

#### Scenario: Agent attempts to modify production source without active change
- **WHEN** an agent issues an `Edit` or `Write` command targeting a production source file (`.ts`, `.js`, `.py`, `.vue`)
- **AND** there is no active change in `openspec/changes/` containing unchecked tasks in `tasks.md`
- **THEN** the SDD gate blocks execution and returns an error explaining that specification must precede implementation.

#### Scenario: Agent modifies non-production file or active change exists
- **WHEN** an agent modifies a file in `test/`, `docs/`, `openspec/`, or a valid active change exists
- **THEN** the SDD gate permits the operation to proceed.

### Requirement: Cross-Artifact Analyze Gate
The system MUST perform cross-artifact validation verifying 100% requirement-to-task coverage, zero orphan tasks, and compliance with the project constitution before implementation starts.

#### Scenario: Delta spec has unmapped requirements
- **WHEN** the Analyze gate inspects an OpenSpec change
- **AND** one or more requirements in `specs/` are not covered by any task in `tasks.md`
- **THEN** the Analyze gate flags the change as inconsistent and rejects implementation until coverage is complete.

#### Scenario: All requirements covered and constitution respected
- **WHEN** every requirement maps to a task, no orphan tasks exist, and no rule in `openspec/project.md` is violated
- **THEN** the Analyze gate passes with zero confirmed blocking gaps.

### Requirement: Surface-Aware Verification
The system MUST classify modified files by runtime surface and execute the corresponding verification strategy.

#### Scenario: Changes affect frontend UI components
- **WHEN** the git diff contains frontend assets (`.vue`, `.tsx`, `.jsx`, `.css`, `.html`)
- **THEN** the surface verifier marks the frontend surface as active and triggers UI/console/network validation checks.

#### Scenario: Changes affect backend API handlers
- **WHEN** the git diff contains API routes, handlers, or schema endpoints
- **THEN** the surface verifier marks the backend surface as active and executes contract verification scripts.

### Requirement: Diff-Match Review Verification and Stale Cache Guard
The system MUST verify that automated code review findings correspond to files actually modified in the branch relative to the merge-base with the target branch.

#### Scenario: Review result references files outside branch diff or finishes in under 10 seconds
- **WHEN** an automated review produces findings
- **AND** the reported files do not overlap with `git diff <base>...HEAD --name-only` or elapsed execution time is under 10 seconds
- **THEN** the review verifier flags the review as STALE and rejects the findings to prevent acting on cached cross-repository data.
