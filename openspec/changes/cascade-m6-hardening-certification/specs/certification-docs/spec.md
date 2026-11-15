# Spec: Certification Documentation

## ADDED Requirements

### Requirement: Current Operator Documentation
The system MUST document dual-runtime execution (Bun and Node 24), `--mode v1|v2`, all engines and aliases, the `doctor`/`catalog`/`drift`/`review` subcommands, telemetry, and CI workflow installation in `README.md` and `docs/cli.md`, and `run_looper.sh` MUST accept a runtime and mode override.

#### Scenario: Documentation matches the CLI
- **WHEN** a test compares `formatHelp()` flags and subcommands against `docs/cli.md`
- **THEN** every flag and subcommand in the help text is documented
