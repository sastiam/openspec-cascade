# Stage 9: Implementation Readiness Test

Target: `tasks.md` (DetailedRange), against `design.md` and the spec delta. Reviewers: `egm-implementation-readiness` (completed), `egm-codebase-details` (completed), `egm-style` (completed). Verdict of both content reviewers: not ready.

## Harness check done by the Elephant (confirms IR-9-3)

The cascade harness runs every backticked command of a task that starts with `bun`, `bunx`, `npm`, `pnpm`, `yarn` or `tsc --noEmit` (`src/facade/tasks.ts:97-112`) and accepts the task only if all of them succeed (`src/facade/cascade_facade.ts:660-694`). Therefore:
- Task 1.1 (`bun test test/cli/spec_gate.test.ts` expected red) can never be accepted.
- Task 2.2 (`bun run cascade.ts spec-gate check ...` expected to exit 1) can never be accepted.
`lint-tasks` does not catch either case.

## egm-implementation-readiness — 0 blockers, 6 majors, 4 nits

- IR-9-1 🟡 Lines 5, 10: error-line format left to the agent; the test-writing session would fix the wording. Close IZ-8-3 with literal example lines; tests assert literal substrings, not imported constants.
- IR-9-2 🟡 Lines 5, 10: match rule unspecified (IZ-8-1); add a dotted-name scenario.
- IR-9-3 🟡 (🔴 if the harness judges by exit code — it does, see above) Line 6: red-test Verify cannot be judged mechanically.
- IR-9-4 🟡 Lines 5-6: replacing the ghost test loses the only test that reaches `missing`; add an existing-folder `drift missing` test.
- IR-9-5 🟡 Lines 10, 12: no file list; resolver location open (IZ-8-5).
- IR-9-6 🟡 Lines 11, 13: "no new failures" needs a baseline; 2.2's checks already exit 1 today and are prose; 2.2 commits nothing.
- IR-9-7 🟢 `bun run audit` (forensic audit) never run.
- IR-9-8 🟢 "Folder exists" undefined (IZ-8-4).
- IR-9-9 🟢 Unknown test must have no `archive/` folder; read errors caught inside the resolver.
- IR-9-10 🟢 2.2 depends on cwd; add `--repo .`.

## egm-codebase-details — 5 majors, 4 nits (references otherwise confirmed accurate)

- CD-9-1 🟡 Message templates, prefix, relative vs absolute path, and how a template is stored in an `as const` object are unspecified.
- CD-9-2 🟡 "Existing change is unaffected" has no test (`makeRepo` always writes `review.md`).
- CD-9-3 🟡 `docs/cli.md:142` lists the reasons `missing, malformed, open, stale` and `:122` describes exit 1; both become inaccurate and no doc file is in scope.
- CD-9-4 🟡 No file paths or Create/Modify markers in tasks.md; reuse `changeDirOf` and `C.OPENSPEC_DIR`/`C.CHANGES_DIR`.
- CD-9-5 🟡 Match: strip an anchored `^\d{4}-\d{2}-\d{2}-` prefix and compare the rest as a string; only directory entries count (as `specFiles` does, `spec_marker.ts:39-40`).
- CD-9-6 🟢 "pure" vs I/O; state the signature and that I/O errors map to unknown.
- CD-9-7 🟢 `--changes archive` resolves as present.
- CD-9-8 🟢 2.2 depends on cwd.
- CD-9-9 🟢 1.1's Verify can pass for the wrong reason unless each new test asserts on stderr text.

Confirmed accurate: `runCheck`, `evaluateStage`, `SPEC_GATE_CONSTANTS`, the ghost test, `package.json` scripts, the real archive `2026-11-16-tasks-lint`, the forensic audit enforced through `bun test`, no other test or in-repo caller parsing the `missing` text.

## egm-style — 0 blockers, 5 majors, 5 nits

- SY-9-1 🟡 Line 5: "each scenario" but only five of six listed.
- SY-9-2 🟡 Line 5: mixed-list fixture must have a resolved, fresh review for the existing change.
- SY-9-3 🟡 Line 5: what the tests assert (exact string, substring) is unstated.
- SY-9-4 🟡 Line 6: "fails only on the new tests" does not require every new test to fail.
- SY-9-5 🟡 Line 11: "pass" vs "no new failures" contradict.
- SY-9-6 🟢 Path forms (trailing slash, relative or absolute).
- SY-9-7 🟢 "as today" is time-relative.
- SY-9-8 🟢 Missing-archive no-crash path untested; "their own error line" vague.
- SY-9-9 🟢 2.2 "Check the real case" is not an outcome.
- SY-9-10 🟢 Stream (stderr) and exact path not named in 2.2's Verify.
