# Design: QA Stage, Auto-Diagrams & 24/7 Resilience

## Context

An agent harness must act as an unyielding quality gate. Supplying rich error output on failure allows the AI to self-correct during retries.

## Decisions

1. **Verification Feedback Loop**: Capture command output and format into a structured error block for task retry prompts.
2. **Diagram Synchronization**: Execute `graphify update .` and Archify CLI rendering upon change completion.
3. **Rollback Buffer**: Execute `git reset --hard` if max attempts are exceeded.
