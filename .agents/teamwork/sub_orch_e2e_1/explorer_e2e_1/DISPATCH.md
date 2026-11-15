# Dispatch — `explorer_e2e_1`

- **Role:** `teamwork_preview_explorer` (Read-Only Codebase Explorer)
- **Parent:** `sub_orch_e2e_1`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (read `## 2026-11-15T01:46:44Z`)
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Scope File:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/SCOPE.md`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/explorer_e2e_1/handoff.md`

## Investigation Tasks
1. Inspect root files: `cascade.ts`, `config.ts`, `platform.ts`, `qa.ts`, `engine.ts`, `resilience.ts`, `skills.ts`, `diagrams.ts`, `package.json`, `tsconfig.json`, `eslint.config.js`.
2. Document every CLI flag, environment variable (`CASCADE_*` or others), config file (`.openspec-cascade.json` or similar), exit code, protected-branch check, dirty-tree check, dry-run behavior, and package manager detection behavior currently implemented in `cascade.ts`, `config.ts`, `platform.ts`, and `qa.ts`.
3. Document exact ESLint rules (especially `no-magic-numbers`, `no-explicit-any`, clean-code/comment rules, etc.) and `tsconfig.json` compiler options / `include` / `exclude` patterns affecting `test/e2e/**/*.ts`.
4. Note how `package.json` scripts run `typecheck`, `lint`, and `test`. Do NOT edit any files outside your `handoff.md`.
