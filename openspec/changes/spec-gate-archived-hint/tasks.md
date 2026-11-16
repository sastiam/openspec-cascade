# Tasks

## 1. Failing tests

- [ ] 1.1 In `test/cli/spec_gate.test.ts`, replace the test "check exits 1 with a missing report for an archived or unknown change" with tests for each scenario of the `spec-gate` spec delta: archived (the error names the change as archived and gives the `openspec/changes/archive/YYYY-MM-DD-<change>` folder), archived twice (the latest date is given), unknown (the error names the change as not existing and gives `openspec/changes/<change>/`), shared suffix (`2026-01-01-big-thing` does not make `thing` archived), and a mixed list (only the archived change is reported). Every case exits 1. Build the archive folders in the temporary repo the tests already create.
  Verify: `bun test test/cli/spec_gate.test.ts` fails only on the new tests, and the rest of that file passes.

## 2. Implementation

- [ ] 2.1 Make `spec-gate check` resolve each change folder before evaluating its stage, following design.md: present changes are evaluated as today, archived and unknown changes get their own error line, and the exit code stays 1. Archive folder name, date pattern and both message templates are named constants in `SPEC_GATE_CONSTANTS`; no comments inside function bodies.
  Verify: `bun test test/cli/spec_gate.test.ts` passes, then `bun test`, `bun run typecheck` and `bun run lint` pass with no new failures.
- [ ] 2.2 Check the real case: in this repository `tasks-lint` is archived under `openspec/changes/archive/2026-11-16-tasks-lint`.
  Verify: `bun run cascade.ts spec-gate check --stage review --changes tasks-lint` prints that `tasks-lint` is archived with that folder and exits 1, and `bun run cascade.ts spec-gate check --stage review --changes no-such-change` prints that it does not exist and exits 1.
