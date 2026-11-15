# Dispatch — `sub_orch_e2e_2` (E2E Testing Track Phase A — Iteration 2)

- **Parent Orchestrator:** `teamwork_preview_orchestrator_cascade_2` (`7130706a3851799c500958d404249b61`)
- **Working Directory:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2`
- **Repository Root:** `/home/antigravity/sastiam/openspec-cascade`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (`## 2026-11-15T01:46:44Z`)
- **Master Plan:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`

## Prior Iteration 1 Context & Findings to Remediate
Read:
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/SCOPE.md`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/GATE_STATUS.md`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/test_writer_e2e_1/handoff.md`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/reviewer_e2e_1/handoff.md`
- `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/reviewer_e2e_2/handoff.md`

Required Remediation Items for Iteration 2:
1. `test/e2e/helpers/constants.ts` & `test/e2e/helpers/temp_repo.ts:145`: Define `JSON_INDENT_SPACES: 2` in `E2E_CONSTANTS` and use it instead of `E2E_CONSTANTS.EXIT_CODE_FATAL`.
2. `TEST_INFRA.md:93`: Fix Tier sum arithmetic breakdown to `(59 T1 + 67 T2 + 60 T3 + 46 T4)` matching lines 71–91.
3. Replace `${Date.now()}` temp directory construction in `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts` (lines 109, 193, 208) and `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` (lines 62, 96, 141) with `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))` and ensure deterministic cleanup.
4. Investigate and harden `f17_f20_telemetry_hygiene_docs.test.ts:136` (`syncResult.archify.length`) against any transient concurrency/state flake observed by `reviewer_e2e_2`.
5. Update `TEST_READY.md` with freshly verified test/typecheck/lint counts.

## Mandatory 2B Execution & Constraints
1. Execute full 2B loop: 3 parallel `teamwork_preview_explorer` -> 1 `teamwork_preview_test_writer` (or `teamwork_preview_worker`) -> 2 independent `teamwork_preview_reviewer` -> 2 independent `teamwork_preview_challenger` -> 1 `teamwork_preview_auditor` (NON-SKIPPABLE, BINARY VETO) -> `GATE_STATUS.md`.
2. Write Ownership: `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**` ONLY. Do NOT modify `src/`, root `*.ts`, `package.json`, `eslint.config.js`, `openspec/**`, `PROJECT.md`.
3. Do NOT run `git commit` or `git push`.
4. Ensure `export PATH="$HOME/.bun/bin:$PATH"` in all subagent dispatches. Remember `bun test` may dirty `.agents/teamwork/reviewer_INTEG-RUN-001/` (note in handoff; do not touch/commit `.agents/teamwork/`).
5. Upon Gate PASS, write `handoff.md` in your working directory listing all verified checks and modified files, and call `send_message` to `7130706a3851799c500958d404249b61`.
