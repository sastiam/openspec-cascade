---
egm: drift
status: resolved
hash: c0e8f73262746f346249cf529afc0bd6ba3b024e7c953123d514a0a36f524b6e
---
## design.md

- Decision 3 says `parseTasks` uses a `normalizeLines` function "that `lintTasks` also imports". In the code `normalizeLines` is defined in `src/sdd/tasks_lint.ts` and `src/facade/tasks.ts` imports it, the opposite direction. The reason (the `sdd` module must not depend on the facade module, which pulls in config, platform, qa and skills) is not in the design.
- Decision 5 calls the helper extraction "a pure move". `parseChangeNames` in `src/cli/change_args.ts` also removes duplicate change names, so `spec-gate check --changes a,a` now checks and lists `a` once. Before the move it listed `a` twice. The design assigns duplicate removal to `lint-tasks` only (Decision 4).
- Decision 5 says `SpecGateOutput` "becomes a neutral `CliOutput`-shaped type there". `src/cli/spec_gate.ts` still exports `SpecGateOutput` as an alias of `CliOutput`, and `src/cli/commands.ts` re-exports `CliOutput` and keeps its own `consoleOutput`. Neither is described.
- Decision 1 lists a `Verify:` token among the `TASKS_LINT_CONSTANTS`. There is no separate token constant; `Verify:` exists only inside the `VERIFY_LINE` pattern. `TASKS_LINT_CONSTANTS.SUBCOMMAND` is defined and never used.
- Decision 7 says the preflight runs "before the v1/v2 split" but does not say where. `lintChanges` runs first in `preflight`, before the `--settings` check and before the protected-branch and dirty-tree checks, so a `tasks.md` finding is reported before a protected-branch error on the same run.
- Decision 7 says the `Fatal` lists the findings "in the CLI line format". The code also prepends a fixed header line (`FATAL_HEADER`: "tasks.md failed lint-tasks; fix these findings before running:"). The header is not described.

## specs/tasks-lint/spec.md

No drift detected.
