# Spec: Adversarial Hardening

## ADDED Requirements

### Requirement: Change Id Allowlist
The system MUST reject change ids containing path separators, `..`, leading dots or characters outside `[A-Za-z0-9._-]` with `ConfigValidationError` (exit `2`).

#### Scenario: Traversal attempt via --changes
- **WHEN** `cascade.ts --changes ../../etc --dry-run` runs
- **THEN** it exits `2` before reading any file outside the repository

### Requirement: Verify Command Injection Guard
The system MUST drop task-provided verify commands containing shell control operators or substitutions.

#### Scenario: Chained command in tasks.md
- **WHEN** a task declares ``Verify: `bun test; touch /tmp/pwned` ``
- **THEN** `verifyCommands` does not return that command and running the task never creates `/tmp/pwned`

### Requirement: Alias-Aware Forensic Audit
The system MUST flag mocks and spies in E2E tests even when imported under an alias.

#### Scenario: Aliased mock
- **WHEN** an E2E test imports `{ mock as fake }` from `bun:test` and calls `fake()`
- **THEN** the forensic audit reports an `e2e-stub` violation

### Requirement: Trailing-Dot Path Normalization
The system MUST classify `src/app.ts.` and `src/app.ts ` as production source in both the TypeScript SDD gate and the plugin hook.

#### Scenario: Windows trailing-dot bypass
- **WHEN** the hook receives a write to `src/app.ts.` without an active change
- **THEN** it blocks with exit `2`

### Requirement: Tier 5 Adversarial Suite
The system MUST ship `test/e2e/tier5_adversarial/` exercising redaction bombs, budget injection, traversal, command injection, symlink escapes, process-tree cleanup, audit evasion and anti-cheat detection against real modules.

#### Scenario: Suite passes without stubs
- **WHEN** `bun test test/e2e/tier5_adversarial` and the forensic audit run
- **THEN** every probe passes and the audit reports zero `e2e-stub` violations

### Requirement: Gates Review the Complete Working Tree
The system MUST give Gates 1, 2 and 3 the complete diff between the task baseline and the working tree, including untracked files, computed through a shadow commit without mutating the user's index.

#### Scenario: Cheating in new untracked files is vetoed
- **WHEN** a worker adds an untracked test with `expect(true).toBe(true)` and a `throw new Error("not implemented")` placeholder during a v2 task
- **THEN** Gate 3 vetoes the task, no checkpoint commit is created, and the run fails closed
