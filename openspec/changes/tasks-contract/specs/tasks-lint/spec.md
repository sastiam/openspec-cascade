# Spec Delta

## ADDED Requirements

### Requirement: Manual steps in tasks.md are findings
The lint SHALL report one finding, rule `manual-step`, on the line of each unchecked task whose block contains a manual-step phrase. The block is the task line plus its continuation lines. Text inside backtick spans SHALL be ignored. Checked tasks SHALL NOT be linted. The message SHALL tell the author to move the step to `manual.md`.

#### Scenario: English manual step
- **WHEN** an unchecked task says "Deploy to staging and confirm the endpoint answers"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Phrase inside a code span
- **WHEN** an unchecked task says "Rename `deployToStaging` to `deployStage`"
- **THEN** the lint reports no `manual-step` finding

#### Scenario: Checked manual step
- **WHEN** a task marked `[x]` says "Deploy to staging"
- **THEN** the lint reports no finding

#### Scenario: Two phrases in one task
- **WHEN** an unchecked task says "Manually deploy to staging"
- **THEN** the lint reports exactly one `manual-step` finding for that task

### Requirement: Manual-step phrase list
Manual-step phrases SHALL match case-insensitively and SHALL cover English and Spanish, including every phrase named in the scenarios below. A task that cascade already treats as a human task ("open the PR", "git push", "decide the delivery") SHALL NOT be a finding.

#### Scenario: English phrases
- **WHEN** an unchecked task contains any of "manually", "manual step", "by hand", "the user must", "the user should", "ask the user", "deploy to", "in the console" or "you must run"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Spanish phrases
- **WHEN** an unchecked task contains any of "manualmente", "a mano", "el usuario debe", "pide al usuario", "despliega en", "desplegar en", "en la consola" or "ejecuta tú"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Spanish manual step
- **WHEN** an unchecked task says "El usuario debe aprobar el cambio en la consola"
- **THEN** the lint reports a `manual-step` finding on the task line

#### Scenario: Existing human task
- **WHEN** an unchecked task says "Open the PR"
- **THEN** the lint reports no `manual-step` finding

### Requirement: manual.md steps need a Check line
When `openspec/changes/<change>/manual.md` exists, `lint-tasks` and the preflight lint SHALL also lint it. Each top-level list item (`- ` at column 0) is a manual step. A step without an indented `Check:` line in its block SHALL be a finding with rule `missing-check` on the step line. Fenced code blocks in `manual.md` SHALL NOT be findings. A change without `manual.md` SHALL produce no manual findings.

#### Scenario: Valid manual.md
- **WHEN** `manual.md` has two steps, each followed by an indented `Check:` line
- **THEN** the lint reports no finding for `manual.md`

#### Scenario: Step without Check
- **WHEN** a step in `manual.md` has no `Check:` line
- **THEN** the lint reports a `missing-check` finding on the step line

#### Scenario: No manual.md
- **WHEN** the change has no `manual.md`
- **THEN** the lint reports only `tasks.md` findings

### Requirement: manual.md has no checkboxes
A step in `manual.md` that starts with a checkbox (`- [ ]` or `- [x]`) SHALL be a finding with rule `manual-checkbox`, so that OpenSpec never counts manual steps as tasks. Findings for `manual.md` SHALL use the line format `<change>: manual.md:<line>: <rule> <message>`.

#### Scenario: Checkbox in manual.md
- **WHEN** a step in `manual.md` starts with `- [ ]`
- **THEN** the lint reports `<change>: manual.md:<line>: manual-checkbox …` on that line

### Requirement: Manual steps are listed at the end of a run
At the end of a run that is not a dry run, the final report SHALL list, for each change that has a `manual.md`, every manual step with its `Check:` text. The harness SHALL NOT run the checks.

#### Scenario: Change with manual steps
- **WHEN** a run finishes a change whose `manual.md` has the step "Approve the release in the console" with check "the release shows Approved"
- **THEN** the final report lists that step and its check under the change

#### Scenario: Change without manual.md
- **WHEN** a run finishes a change without `manual.md`
- **THEN** the final report has no manual steps for that change
