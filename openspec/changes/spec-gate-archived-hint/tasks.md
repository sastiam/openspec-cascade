# Tasks

## Files

- Modify: `src/cli/spec_gate.ts`, `src/config/constants.ts`, `test/cli/spec_gate.test.ts`, `docs/cli.md`.
- Untouched: every other file, including `src/cli/change_args.ts`, `src/sdd/spec_marker.ts` and the `stamp` path.

## 1. Archived and missing change folders in spec-gate check

- [ ] 1.1 Test first, then implement, in this one task. First, in `test/cli/spec_gate.test.ts`, replace the test "check exits 1 with a missing report for an archived or unknown change" with one test per scenario of the `spec-gate` spec delta, all seven: archived, archived twice, no change folder (with no `archive/` directory in that temporary repo), shared suffix (`2026-01-01-big-thing` for `thing`), dotted name (`2026-01-01-a-b` for `a.b`), existing change with an absent report (stage `drift`: the line is exactly `a: drift missing (drift.md)`, also when an archived copy of `a` exists), and a mixed list (the existing change has a review stamped resolved and still fresh). Each test asserts exit code 1 and the exact stderr line from the spec, as a string literal in the test (not imported from constants). Run the spec-gate test file and see the new tests fail before changing any source file. Then implement the design.md decisions in `src/cli/spec_gate.ts` (one private function, archive read errors treated as an empty archive) and add the two reasons, the archive directory name and the date prefix pattern to `SPEC_GATE_CONSTANTS` in `src/config/constants.ts`. No comments inside function bodies.
  Verify: `bun test test/cli/spec_gate.test.ts` passes, `bun run typecheck` passes, `bun run lint` passes and `bun run audit` passes.

## 2. Docs and full suite

- [ ] 2.1 In `docs/cli.md`, update the `spec-gate` row so exit 1 also covers a change that is archived or has no change folder, and the `check` bullet so its list of reasons is `missing`, `malformed`, `open`, `stale`, `archived` and `no change folder`, with the two example lines from design.md.
  Verify: `bun test` passes with zero failures.
