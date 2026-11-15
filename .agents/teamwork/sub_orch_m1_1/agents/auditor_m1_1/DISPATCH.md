# Dispatch: auditor_m1_1 (Forensic Integrity Audit — Iteration 1)

- **Agent Type:** `teamwork_preview_auditor`
- **Role:** M1 Forensic Integrity Auditor
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/auditor_m1_1`
- **Handoff Path:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/auditor_m1_1/handoff.md`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`
- **Scope:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/SCOPE.md`

## Audit Instructions
Perform the complete 8-point Forensic Integrity Audit on Milestone M1 (Iteration 1) without modifying any repo files:
1. Verify implementations in `src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `src/pal/adapters/*`, `src/engine/rollback_buffer.ts`, `src/integration/github_project.ts`, `projects/agnostic_looper/verify_project_items.ts` are genuine (no hardcoded outputs, no bypassed checks, no stubs).
2. Verify all unit/integration tests (`test/config/*.test.ts`, `config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `lint.test.ts`, `engine.test.ts`, `test/integration/github_project.test.ts`) import real production modules (zero fake stubs/mocks).
3. Verify zero `any` / `as any` in AST and `@typescript-eslint/no-explicit-any: "error"` enforced in `eslint.config.js`.
4. Verify zero magic numbers / uncentralized literals in all M1-created and M1-modified files.
5. Verify Clean Code Rule #1 (zero inline `//` comments inside function bodies across ALL M1-created and M1-modified files — note Reviewer 2 flagged 6 M1-modified `src/` files).
6. Verify OpenSpec `--strict` compliance (`openspec/changes/cascade-m1-config-guardrails/`) and `analyzeChangeArtifacts`.
7. Verify write-ownership boundaries (`TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, `PROJECT.md` untouched).
8. Run `export PATH="$HOME/.bun/bin:$PATH"`, `bun test`, `bun run typecheck`, `bun run lint`, and `bunx openspec validate cascade-m1-config-guardrails --strict`.

Emit explicit verdict (`CLEAN` / `PASS` OR `INTEGRITY VIOLATION` / `FAIL`) with exact file:line evidence in `handoff.md` and report via `send_message`.
