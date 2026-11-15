# Spec: Self-Improving Looper

## ADDED Requirements

### Requirement: Redacted Telemetry Persistence
The system MUST append run outcomes as redacted JSON lines to `.cascade/telemetry/<YYYY-MM-DD>.jsonl` and read them back, skipping malformed lines.

#### Scenario: Secrets never reach disk
- **WHEN** `recordOutcome` receives a failure trace containing an API token
- **THEN** the persisted line contains `[REDACTED]` instead of the token and `loadHistory` returns the record

### Requirement: Bounded Remediation Directives
The system MUST derive at most `MAX_DIRECTIVES` directives from failure signatures observed at least `MIN_OCCURRENCES` times, deterministically ordered by frequency then recency.

#### Scenario: Recurring failures become directives
- **WHEN** history contains the same TypeScript error three times with different line numbers and one unrelated failure
- **THEN** `deriveDirectives` returns one `type_error` directive with `occurrences: 3`

#### Scenario: Directives reach the harness
- **WHEN** telemetry is enabled and history contains recurring failures
- **THEN** the next session prompt contains the remediation section
