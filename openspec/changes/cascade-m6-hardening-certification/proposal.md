# Proposal: Milestone M6 — Adversarial Hardening, Documentation & Dual-Runtime Certification

## Why

An adversarial probe of the M1–M5 surface found four exploitable gaps: (1) `--changes ../../etc` is accepted, so the facade, the v2 pipeline and the harness read `tasks.md` and artifacts outside the repository; (2) `Verify:` spans in `tasks.md` such as ``bun test; touch /tmp/pwned`` pass the package-manager prefix check and run through the shell, enabling command chaining and spoofed verification; (3) the forensic audit misses mocks imported under an alias (`import { mock as fake } from "bun:test"`); (4) the SDD gate classifies `src/app.ts.` (trailing dot, which Windows strips) as non-production; (5) the v2 pipeline handed Gates 1–3 neither a diff nor target files, and `git diff <baseline>` omits untracked files, so Gate 3's anti-cheat scan saw nothing and new files escaped review. The README, CLI reference and looper script also predate M2–M5 (Node 24, `--mode v2`, subcommands, CI template).

## What Changes

1. **Change-id validation**: `CascadeConfigSchema` validates every change id against `HARDENING_CONSTANTS.CHANGE_ID_PATTERN` (no separators, no `..`), failing closed with exit `2`.
2. **Verify-command hardening**: `verifyCommands` drops task-provided commands containing shell control operators or substitutions (`;`, `&`, `|`, `` ` ``, `$(`, `>`, `<`, newlines) and logs nothing to the shell; the default verification still applies.
3. **Forensic alias detection**: the `e2e-stub` rule resolves named-import aliases of `mock`/`spyOn` from `bun:test`, `vitest` and `@jest/globals`.
4. **Complete working-tree diffs for gates**: `ShadowCommitManager.workingTreeDiff(repo, baseline)` produces the patch and file list including untracked files; the v2 pipeline passes them to Gates 1–3.
5. **SDD path normalization**: production classification strips trailing dots and spaces from the file name in both the TypeScript gate and the generated plugin hook core.
6. **Tier 5 adversarial suite** (`test/e2e/tier5_adversarial/`): redaction bombs, budget overflow/NaN injection, change-id traversal, verify-command injection, symlink escapes in shadow commits, SIGTERM-ignoring process trees, forensic-audit evasion and Gate 3 anti-cheat probes, all against real modules and the real CLI.
7. **Docs & scripts**: `README.md`, `docs/cli.md` and `run_looper.sh` document dual-runtime execution, `--mode v2`, engines, subcommands, telemetry and CI installation.

## Definition of Done

- `bunx openspec validate cascade-m6-hardening-certification --strict` exits `0`.
- All Tier 1–5 E2E suites, the full `bun test` suite, `tsc`, `eslint`, the forensic audit, the hook sync check, `openspec validate --all --strict` and the Node 24 parity suite exit `0`.
