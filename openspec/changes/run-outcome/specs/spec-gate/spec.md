# Spec Delta

## ADDED Requirements

### Requirement: Code-review stage
`spec-gate check` and `spec-gate stamp` SHALL accept the stage `code-review`, whose report is `code-review.md`, with the same stamp format, statuses and staleness rules as `review` and `drift`.

#### Scenario: Stamp and check code review
- **WHEN** `spec-gate stamp --stage code-review --change a --status resolved` runs on a change with `code-review.md`
- **THEN** `spec-gate check --stage code-review --changes a` exits 0

#### Scenario: Missing code-review report
- **WHEN** a change has no `code-review.md`
- **THEN** `spec-gate check --stage code-review --changes a` reports `a: code-review missing (code-review.md)` and exits 1
