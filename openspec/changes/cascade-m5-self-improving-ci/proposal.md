# Proposal: Milestone M5 — Self-Improving Looper, Bounded Pre-PR Loop, Integration CLI & CI

## Why

Run outcomes vanish after each cascade: recurring failures (the same type error, the same flaky command, the same lint rule) are rediscovered every session. The pre-PR review verifier and the Greptile bridge exist but nothing loops review → fix → re-review with a bound. The catalog generator, drift detector and GitHub Project service have no CLI entry point, there is no environment diagnosis, and the repository has no CI enforcing the dual-runtime suite. Orchestration state under `.agents/teamwork/` and local caches are committed or uncovered by `.gitignore`.

## What Changes

1. **F17 — `src/core/self_improver.ts`**: `SelfImprover.recordOutcome(telemetry)` appends redacted records to `.cascade/telemetry/<date>.jsonl`; `loadHistory()` reads them back; `failureSignature()` normalizes traces (numbers, paths, hashes, quoted literals) into stable signatures; `deriveDirectives(history)` turns signatures seen at least `MIN_OCCURRENCES` times into at most `MAX_DIRECTIVES` category-specific `RemediationDirective`s. `CascadeFacade` records engine sessions and v2 gate failures and feeds directives to `HarnessInjector` when telemetry is enabled.
2. **F18 — `src/core/pre_pr_loop.ts`**: `PrePrReviewLoop.run()` reviews through any `review()` source (the Greptile bridge), stops on `stale`/`mismatch`, escalates `risky` findings to humans, auto-fixes `mechanical` findings through a fixer callback and re-reviews, bounded to `<= 3` rounds.
3. **F18 — `src/cli/commands.ts`**: subcommands `doctor` (toolchain, engines, Greptile, plugin hook sync, telemetry), `catalog --sync` (GitHub Project → catalog files), `drift` (catalog vs GitHub Project or a remote JSON snapshot), and `review` (bounded pre-PR loop) dispatched by `cascade.ts` before regular flag parsing.
4. **F19 — CI & hygiene**: `.github/workflows/ci.yml` runs typecheck, lint, forensic audit, plugin sync check, `openspec validate --all --strict`, the Bun suite, and the Node 24 parity suite; `.gitignore` covers `.cascade/`, `.redteam_sandbox_*` and `.agents/teamwork/`, and orchestration state is untracked.

## Definition of Done

- `bunx openspec validate cascade-m5-self-improving-ci --strict` exits `0`.
- `bun test`, `bunx tsc --noEmit`, `bunx eslint .`, the forensic audit, the plugin sync check and `npm run test:node` exit `0`.
