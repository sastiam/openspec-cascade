---
egm: drift
status: open
hash: b92042bc649222472c2292ce6240170cbdfd532c2f8d531e72970f161204a46a
---
## design.md

- **Nit, undocumented edge case (baseline output).** The design says the baseline passes only a `log` hook, so it "prints no `check:` lines" and "the failure message names the commands" (design.md:96, :135). That part is true. But when a baseline command fails, `runVerificationPhase` still prints the tail of that command's output with `console.log(tailLines)` (`qa.ts:172-179`). The `say` hook does not control this. The output goes straight to stdout, not through the facade's `output`, and the run log does not record it. `checkAlwaysVerifyBaseline` (`src/facade/cascade_facade.ts:359-371`) sends every failing baseline command through this path, because it sets `stopOnFirstFailure: false`. Neither the Context paragraph on `runVerificationPhase` (design.md:17) nor D8 mentions this output.

## specs/task-verification/spec.md

- **Scenario "Nothing to report" is only partly tested.** The spec says three things (spec.md:77-79): the ignored list is empty, no `verify_ignored` event is written, and the plan line has no `ignored=` flag.
  - The unit test checks only the empty list (`cascade.test.ts:162-165`).
  - No test runs a non-dry v1 run on a task whose marker starts its text and checks that the run log has no `verify_ignored` line. The only `verify_ignored` assertion is the positive case (`test/facade/cascade_facade.test.ts:525-530`).
  - The dry-run journey test uses `toContain("1.3 commit=feat(api) verify=[bun test]")` (`test/e2e/tier4_scenarios/dry_run_cascade_journey.test.ts:71`). That test still passes if ` ignored=[...]` were added to the line, so the "no `ignored=` flag" part has no test. design.md:61 relies on this same test to show that no flag is added.
- **Scenario "Architecture check on a task with Verify" is only partly tested.** The spec expects the checks to be exactly `["bun test", "bun run arch:check"]`, shown in both the agent's prompt and the dry-run plan (spec.md:84-86). The spec's Purpose says `alwaysVerify` scenarios compute merged checks from a config loaded from a directory without `package.json` (spec.md:7).
  - The `taskChecks` unit block has no test for this scenario. It covers only Duplicate, Commands run as written, Empty setting, and No Verify (`test/facade/tasks.test.ts:68-85`).
  - The only test is the facade test. It uses a repo with a `package.json` and a different task check, `bun run unit:check` (`test/facade/cascade_facade.test.ts:454-457, :490-507`).
  - Its prompt check confirms only that `engine.prompts[0]` contains `bun run arch:check` (`cascade_facade.test.ts:506`). No test checks that the prompt also shows the task's own check, which the spec requires with "show both".
  - No test asserts the exact merged list for the scenario's task lines.
