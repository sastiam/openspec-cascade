# Platform Runner Specification

## ADDED Requirements

### Requirement: Cross-Platform Process Keep-Alive
The system MUST prevent OS sleep during task execution on both macOS and Linux.

#### Scenario: Running cascade on macOS
- **WHEN** `cascade.ts` starts on macOS
- **THEN** it activates system keep-alive using `caffeinate` or native process flags.

#### Scenario: Running cascade on Linux
- **WHEN** `cascade.ts` starts on Linux
- **THEN** it activates system keep-alive using `systemd-inhibit` or process hold signals.
