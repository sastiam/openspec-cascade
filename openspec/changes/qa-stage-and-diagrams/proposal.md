# Proposal: QA Verification Stage, Auto-Diagrams & 24/7 Resilience

## Why

Autonomous 24/7 task execution requires a robust QA stage with error feedback loops, automatic diagram updates (Graphify & Archify), and a rollback state buffer.

## What Changes

- Implement `runVerificationPhase` providing structured error feedback loops (test, tsc, lint, build) to agent retries.
- Automate Graphify (`graphify update .`) and Archify diagram generation upon change completion.
- Add git/CoW rollback buffer to restore clean state if 3 consecutive retries fail.

## Definition of Done

- Failing verification commands feed stdout/stderr stack traces back into agent retry prompts.
- Graphify and Archify diagrams update automatically when changes are completed.
- Failed tasks perform git rollback without leaving dirty working tree artifacts.
