# Proposal

## Why

`openspec-cascade spec-gate check --changes <x>` reports `<x>: review missing (review.md)` when the change folder does not exist. That text is wrong in both cases it covers: after `archive` the review exists, only in the archive, and with a mistyped name there is no change at all. The 0b validation hit it right after archiving `tasks-lint`, and nothing explained why the gate failed.

## What Changes

- When `openspec/changes/<change>/` does not exist, `spec-gate check` reports why instead of a missing report:
  - archived: the change is named as archived, with its folder under `openspec/changes/archive/`;
  - unknown: the change is named as not existing.
- The exit code stays `1` in both cases, so callers (`forja wt night`, scripts) behave as today.
- Changes whose folder exists are checked exactly as today.

## Capabilities

### New Capabilities
- `spec-gate`: the check and stamp gate that records the EGM review and drift stages of a change and blocks unattended runs and archive until they pass.

### Modified Capabilities

## Impact

- Code: `src/cli/spec_gate.ts` (`check` path only) and `src/config/constants.ts`.
- Tests: `test/cli/spec_gate.test.ts`, including the existing archived-or-unknown test.
- No change to `stamp`, to the marker format, to exit codes or to any other subcommand.
