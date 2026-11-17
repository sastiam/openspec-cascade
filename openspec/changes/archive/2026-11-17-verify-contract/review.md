---
egm: review
status: resolved
hash: b92042bc649222472c2292ce6240170cbdfd532c2f8d531e72970f161204a46a
---
# Review: verify-contract (EGM stage 7: design, structural, style)

Status: triaged; all findings addressed or withdrawn.

## Blockers
- `alwaysVerify` is only merged in v1 `runTask`; v2 (`v2_pipeline.ts:230,360`) never applies it, so the spec's "every task" fails in v2 mode.
- Task 3.1 is docs-only, so the docs-only fast-track skips the only full-suite `bun test` (applies to the final docs task of every change in this PR).

## Major
- The segment starts at the first `\bVerify:` anywhere, including inside instructions or backticks; lint-tasks defines the marker as an indented continuation line (`VERIFY_LINE`). Use the same definition.
- Tasks without Verify plus `alwaysVerify`: the harness would mark the box when checks pass even if the agent never ticked it. Require checkbox and checks.
- The merged list must replace `verify` before `taskPrompt` (line 614) and in `printPlan` (line 482), or the agent is never told about the project-wide check.
- `isSafeVerifyCommand` lives in `src/facade/tasks.ts`; importing it into `src/config/schemas.ts` inverts layering (import cycle). Validate with `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` in the config layer, on the resolved schema too (overrides path), with `superRefine` to name the command.
- `both tsc` and `E2E` detections must also read the segment; full verification combined with a Verify marker is unspecified.
- Missing risk: an `alwaysVerify` that already fails on the starting state fails every task.

## Nits
- No Alternatives section; `alwaysVerify` entries run as written (no Nuxt/tsc rewrites); line references will go stale; name helpers and the exact expected lists in tasks.

## Stage 9 (implementation readiness, codebase details, style)

Findings were applied to the artifacts on 2026-11-17. Main points:
- Regression-guard tests are exempt from the red-first rule; behavior-changing tests must fail first.
- Every subcommand or flag is documented in the same task that adds it (docs-parity test), and the last code task runs the whole suite.
- Verify lines use only commands the harness runs (`bun ...`); doc content checks use `bun -e`, not grep.
- Exact literals, fixtures and helper names are given in design.md and tasks.md; ESLint rules (no magic numbers, explicit return types) are stated.

## Triage resolution

- Stage 7 decisions taken by the author on 2026-11-17: v1 only (v2 is being deprecated); read-only investigation with a declared AWS profile and MCP read verbs; manifest with `profile` and `hosts`; doctor runs project checks only with `--run-project-checks`; manifest validated loosely during runs; explore runs propose inline; narrowed manual-step phrases.
- Decision "checkbox plus checks for tasks without Verify" was withdrawn: the preflight lint already rejects such tasks, so the case cannot occur in real runs.
- All remaining findings were addressed in the artifacts; none were declined.
