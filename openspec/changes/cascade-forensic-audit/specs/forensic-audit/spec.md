# Spec: Deterministic Forensic Audit

## ADDED Requirements

### Requirement: AST-Based Forensic Rules
The system MUST detect explicit `any` types, comments inside function bodies, stubbed or mocked E2E tests, and placeholder implementations using the TypeScript AST so that string and template literal contents are never reported.

#### Scenario: Real violations are reported
- **WHEN** `auditSource` processes code containing `function f(x: any) { // explain\n return x; }`
- **THEN** it returns one `explicit-any` violation and one `inline-body-comment` violation with file and line numbers

#### Scenario: Fixture strings are ignored
- **WHEN** `auditSource` processes code whose only `any` or `//` occurrences live inside string or template literals
- **THEN** it returns zero violations

#### Scenario: JSDoc and top-level comments are allowed
- **WHEN** `auditSource` processes a file with module-level `//` comments and `/** */` docblocks before declarations
- **THEN** it returns zero `inline-body-comment` violations

#### Scenario: E2E stubs are rejected
- **WHEN** `auditSource` processes a file under `test/e2e/` that calls `mock(...)`, `mock.module(...)` or `spyOn(...)`
- **THEN** it returns an `e2e-stub` violation for each call

### Requirement: Forensic Audit CLI Gate
The system MUST provide `scripts/forensic_audit.ts` that audits the milestone-scoped path set and exits `0` only when no violations exist.

#### Scenario: Clean scope passes
- **WHEN** the CLI runs over `FORENSIC_AUDIT_SCOPE` with no violations
- **THEN** it prints a summary with the audited file count and exits `0`

#### Scenario: Violations fail the gate
- **WHEN** any audited file contains a violation
- **THEN** the CLI prints each violation as `path:line [rule] message` and exits `1`
