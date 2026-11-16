# Spec Delta

## Purpose

Records the EGM review and drift stages of an OpenSpec change and blocks unattended runs and archive until the required stage is resolved and fresh.

## ADDED Requirements

### Requirement: Check explains a change folder that does not exist
When `spec-gate check` is given a change whose folder `openspec/changes/<change>/` does not exist, it SHALL report that change as archived or as unknown instead of reporting a missing review or drift report, and it SHALL exit with code 1.

#### Scenario: Archived change
- **WHEN** `openspec/changes/<change>/` does not exist and `openspec/changes/archive/` contains a folder named `YYYY-MM-DD-<change>`
- **THEN** the error line names the change as archived and gives that archive folder's path
- **AND** the command exits with code 1

#### Scenario: Archived more than once
- **WHEN** the archive contains two dated folders for the same change
- **THEN** the error line gives the most recent one (the greatest date)

#### Scenario: Unknown change
- **WHEN** `openspec/changes/<change>/` does not exist and no archive folder is named `YYYY-MM-DD-<change>`
- **THEN** the error line names the change as not existing and gives the expected path `openspec/changes/<change>/`
- **AND** the command exits with code 1

#### Scenario: Archive folder of another change with a shared suffix
- **WHEN** the archive contains `2026-01-01-big-thing` and the check is for `thing`
- **THEN** `thing` is reported as unknown, not as archived

#### Scenario: Existing change is unaffected
- **WHEN** `openspec/changes/<change>/` exists
- **THEN** the check reports the same results and exit code as before this change, including `missing` when the stage report is absent

#### Scenario: Mixed list
- **WHEN** `--changes` lists one archived change and one existing change whose review is resolved and fresh
- **THEN** only the archived change is reported, and the command exits with code 1
