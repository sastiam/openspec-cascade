# Spec: Integration CLI Subcommands

## ADDED Requirements

### Requirement: Doctor Diagnosis
The system MUST provide `cascade.ts doctor` reporting runtime, git, OpenSpec, engine binaries, Greptile status, plugin hook sync and telemetry, exiting `0` when required checks pass and `1` otherwise.

#### Scenario: Doctor in a repository
- **WHEN** `doctor --repo <git repo with openspec/>` runs
- **THEN** it prints one line per check with `ok`, `warn` or `fail` and exits `0`

### Requirement: Catalog and Drift Commands
The system MUST provide `catalog --sync` (GitHub Project to catalog files) and `drift` (local catalog versus GitHub Project or `--remote-json` snapshot), failing closed with exit `2` on invalid input and exiting `1` when drift exists.

#### Scenario: Offline drift detection
- **WHEN** `drift --catalog local.json --remote-json remote.json` compares catalogs that differ in one task
- **THEN** it prints the drift summary and exits `1`

#### Scenario: Missing arguments fail closed
- **WHEN** `catalog --sync` runs without `--owner` and `--project`
- **THEN** it exits `2` with a usage message

### Requirement: Review Command
The system MUST provide `review --base <branch> [--rounds <n>]` running the bounded pre-PR loop through the Greptile bridge and the configured engine.

#### Scenario: Greptile not installed
- **WHEN** `review` runs without the Greptile CLI on `PATH`
- **THEN** it exits `2` reporting `not_installed`
