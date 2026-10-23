# QA Verification Stage Specification

## ADDED Requirements

### Requirement: Autonomous QA Verification with Feedback Loop
The harness MUST run full verification commands and re-inject failure traces into agent retries.

#### Scenario: Verification failure
- **WHEN** a verification command (`bun test`, `tsc`, `lint`, `build`) fails
- **THEN** the harness captures stderr/stdout and includes it in the prompt for the next retry attempt.
