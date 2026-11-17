# Spec Delta

## ADDED Requirements

### Requirement: Code-review stage
`spec-gate check` and `spec-gate stamp` SHALL accept the stage `code-review`, whose report is `code-review.md`, with the same stamp format, statuses and change-hash rule as `review` and `drift`, plus the HEAD rule of this spec.

#### Scenario: Stamp and check code review
- **WHEN** `spec-gate stamp --stage code-review --change a --status resolved` runs on a change with `code-review.md`, and nothing else changes
- **THEN** `spec-gate check --stage code-review --changes a` exits 0

#### Scenario: Missing code-review report
- **WHEN** a change has no `code-review.md`
- **THEN** `spec-gate check --stage code-review --changes a` reports `a: code-review missing (code-review.md)` and exits 1

### Requirement: Code-review stamp records the reviewed HEAD
For stage `code-review`, the stamp SHALL add a `head` key with the HEAD commit SHA at stamping time. A `code-review` marker without `head` SHALL be malformed. The `review` and `drift` stamps SHALL NOT change.

#### Scenario: Head key written
- **WHEN** `spec-gate stamp --stage code-review --change a --status resolved` runs at commit `abc123`
- **THEN** the marker of `code-review.md` has `head: abc123` in its full SHA form

### Requirement: Code-review freshness follows HEAD
For stage `code-review`, the check SHALL report `stale` when the change hash differs, when `head` is not a known commit, or when the diff between `head` and HEAD changes any path other than `code-review.md` files. A diff that only changes `code-review.md` files SHALL keep the stamp fresh.

#### Scenario: Own record commit stays fresh
- **WHEN** the stamped `code-review.md` is committed after stamping
- **THEN** `spec-gate check --stage code-review --changes a` exits 0

#### Scenario: Unknown head
- **WHEN** the marker's `head` names no commit in the repository
- **THEN** `spec-gate check --stage code-review --changes a` reports `a: code-review stale (code-review.md)` and exits 1

#### Scenario: Head key missing
- **WHEN** a `code-review` marker has no `head` key
- **THEN** `spec-gate check --stage code-review --changes a` reports `a: code-review malformed (code-review.md)` and exits 1

#### Scenario: Code changed after the review
- **WHEN** a commit after `head` changes `src/a.ts`
- **THEN** `spec-gate check --stage code-review --changes a` reports `a: code-review stale (code-review.md)` and exits 1
