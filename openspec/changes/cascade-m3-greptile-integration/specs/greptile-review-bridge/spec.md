# Spec: Greptile Review Bridge and Semantic Context

## ADDED Requirements

### Requirement: Token-Budgeted Context Formatter
The system MUST render findings as a severity-ordered Markdown block whose estimated token count never exceeds the budget.

#### Scenario: Budget truncation
- **WHEN** `formatGreptileContext` receives more findings than fit in the budget
- **THEN** the output contains the highest-severity findings first, ends with an omission line naming the count left out, and `estimateTokens(output) <= tokenBudget`

### Requirement: Pre-PR Review Bridge
The system MUST run reviews on a shadow worktree, verify findings with `verifyReviewFindings` against the merge-base diff, cache verified results, and return verification, findings, context and cache status.

#### Scenario: Fresh review is verified and cached
- **WHEN** the bridge reviews a feature branch and the client takes at least the minimum review duration
- **THEN** the result has `cached: false`, `verification.status` `ok`, and a second call with an unchanged tree returns `cached: true` without invoking the client

#### Scenario: Stale or mismatched reviews are rejected
- **WHEN** the client responds faster than the minimum review duration, or reports only files outside the branch diff
- **THEN** `verification.status` is `stale` or `mismatch` and the result is not cached
