# Spec: CI and Repository Hygiene

## ADDED Requirements

### Requirement: Dual-Runtime CI Workflow
The system MUST define the CI workflow (canonical template `ci/github-workflows/ci.yml`, installed as `.github/workflows/ci.yml`) running typecheck, lint, forensic audit, plugin sync check, strict OpenSpec validation and the Bun test suite, plus the Node 24 parity suite.

#### Scenario: Installed workflow matches the template
- **WHEN** `.github/workflows/ci.yml` exists
- **THEN** it is byte-identical to `ci/github-workflows/ci.yml`

#### Scenario: Workflow covers both runtimes
- **WHEN** the workflow file is parsed
- **THEN** it contains a Bun job running `bun test` and a Node 24 job running `npm run test:node`

### Requirement: Ignored Local State
The system MUST ignore `.cascade/`, `.redteam_sandbox_*` and `.agents/teamwork/` and keep orchestration state out of version control.

#### Scenario: Local state is ignored
- **WHEN** `git check-ignore` evaluates `.cascade/telemetry/x.jsonl`, `.redteam_sandbox_1/a` and `.agents/teamwork/agent/progress.md`
- **THEN** all three paths are ignored
