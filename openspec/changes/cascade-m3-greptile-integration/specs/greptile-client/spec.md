# Spec: Greptile CLI Client

## ADDED Requirements

### Requirement: Typed Greptile CLI Client
The system MUST provide `GreptileCliClient` implementing `IGreptileClient` (`checkStatus`, `review`, `reviewStatus`, `query`) over `ISpawner`, invoking only documented CLI commands.

#### Scenario: Review parses documented JSON
- **WHEN** `greptile review --json --branch main` prints `{"summary":"s","comments":[{"path":"a.ts","startLine":3,"endLine":4,"severity":"high","securityIssue":false,"body":"bug"}]}`
- **THEN** `review` resolves one finding `{ file: "a.ts", line: 3, endLine: 4, severity: "high", message: "bug" }` and the summary

#### Scenario: Status reports installation and authentication
- **WHEN** `checkStatus` runs with the binary missing, signed out, or signed in
- **THEN** it resolves `{ installed: false }`, `{ installed: true, authenticated: false }`, or `{ installed: true, authenticated: true, version }` without throwing

#### Scenario: Review status maps exit codes
- **WHEN** `greptile review status --json` exits `0`, `3`, `4` or `5`
- **THEN** `reviewStatus` resolves `completed`, `running`, `failed` or `cancelled`

### Requirement: Greptile Error Taxonomy
The system MUST raise `GreptileError` with kind `not_installed`, `auth`, `rate_limit`, `timeout`, `invalid_output` or `command_failed`, marking only `rate_limit` and `timeout` as retryable.

#### Scenario: Invalid output fails closed
- **WHEN** the review command exits `0` with non-JSON stdout
- **THEN** `review` rejects with `GreptileError` of kind `invalid_output`

#### Scenario: Auth failure is not retryable
- **WHEN** the review command exits non-zero with stderr mentioning that the user is not signed in
- **THEN** `review` rejects with kind `auth` and `retryable: false`

### Requirement: Query Ranks Findings
The system MUST implement `query` as relevance ranking of review findings against a question.

#### Scenario: Relevant findings rank first
- **WHEN** `query` receives the question "token refresh in auth module" and findings about `src/auth/token.ts` and `README.md`
- **THEN** the auth finding is returned first with a positive score and zero-score findings are excluded
