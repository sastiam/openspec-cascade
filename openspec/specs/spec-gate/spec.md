# spec-gate Specification

## Purpose

Records the EGM review and drift stages of an OpenSpec change and blocks unattended runs and archive until the required stage is resolved and fresh.

## Requirements

### Requirement: Check explains a change folder that does not exist
When `spec-gate check` is given a change for which no directory exists at `openspec/changes/<change>/`, it SHALL report that change as archived or as having no change folder, instead of reporting a missing review or drift report, and it SHALL exit with code 1. Each such report is one error line on stderr in the existing format `<change>: <stage> <reason> (<path>)`, with the path relative to the repository and without a trailing slash.

#### Scenario: Archived change
- **WHEN** no directory exists at `openspec/changes/<change>/` and `openspec/changes/archive/` contains a directory named `YYYY-MM-DD-<change>`
- **THEN** the error line is `<change>: <stage> archived (openspec/changes/archive/YYYY-MM-DD-<change>)`
- **AND** the command exits with code 1

#### Scenario: Archived more than once
- **WHEN** the archive contains two dated directories for the same change
- **THEN** the error line gives the most recent one (the greatest date)

#### Scenario: No change folder
- **WHEN** no directory exists at `openspec/changes/<change>/` and no archive directory is named `YYYY-MM-DD-<change>`, including when `openspec/changes/archive/` itself does not exist
- **THEN** the error line is `<change>: <stage> no change folder (openspec/changes/<change>)`
- **AND** the command exits with code 1

#### Scenario: Archive directory of another change with a shared suffix
- **WHEN** the archive contains `2026-01-01-big-thing` and the check is for `thing`
- **THEN** `thing` is reported as having no change folder, not as archived

#### Scenario: Change name with a dot
- **WHEN** the archive contains `2026-01-01-a-b` and the check is for `a.b`
- **THEN** `a.b` is reported as having no change folder, not as archived

#### Scenario: Existing change is unaffected
- **WHEN** a directory exists at `openspec/changes/<change>/`, even if an archived copy of the same change also exists
- **THEN** the check reports the same results and exit code as before this change, including `<change>: <stage> missing (<report file>)` when the stage report is absent

#### Scenario: Mixed list
- **WHEN** `--changes` lists one archived change and one existing change whose review is resolved and fresh
- **THEN** only the archived change is reported, and the command exits with code 1
