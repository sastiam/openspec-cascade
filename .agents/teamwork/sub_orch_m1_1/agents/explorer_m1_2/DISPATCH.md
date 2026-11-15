# Dispatch: explorer_m1_2 (Zod Schemas, Guardrails & CLI Fail-Closed Exploration)

- **Agent Type:** `teamwork_preview_explorer`
- **Role:** Schemas & Guardrails Explorer
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/explorer_m1_2`
- **Handoff Path:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/explorer_m1_2/handoff.md`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Scope:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/SCOPE.md`

## Task
Explore F02 (`src/config/schemas.ts`), F03 (`src/config/guardrails.ts`), and F04 (`src/config/loader.ts` & `cascade.ts` CLI/startup):
1. Read `cascade.ts`, `cascade.test.ts`, `config.ts`, `resilience.ts`, `qa.ts`, `engine.ts`, and `src/gates/` or `src/core/` files touching budgets, redaction, protected branches, or dry-run.
2. Inspect CLI flag parsing in `cascade.ts` and `config.ts` (including `--budget`, `--usage-limit`, `--max-turns`, `--dry-run`, `--engine`, `--model`, `--mode`, etc.), import-time side effects (`loadConfig()`), and existing tests that assert CLI exit codes or config errors.
3. Check if `src/config/` or `.openspec-cascade.json` already exists or is referenced anywhere.
4. Document exact contracts needed for `CascadeConfigSchema`, `RuntimeConfigSchema`, `EngineConfigSchema`, `GateBudgetsSchema`, `SddConfigSchema`, `GreptileConfigSchema`, `TelemetryConfigSchema`, `enforceSessionBudget`, `redactSensitiveData`, and protected-branch dry-run guard, ensuring fail-closed exit code `2` on invalid CLI flags or config.
5. Write a detailed findings report to your `handoff.md` and report back via `send_message`.
