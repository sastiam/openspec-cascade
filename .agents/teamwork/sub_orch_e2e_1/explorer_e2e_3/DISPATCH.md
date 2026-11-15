# Dispatch — `explorer_e2e_3`

- **Role:** `teamwork_preview_explorer` (Read-Only Test Suite & Tooling Explorer)
- **Parent:** `sub_orch_e2e_1`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (read `## 2026-11-15T01:46:44Z`)
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Scope File:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/SCOPE.md`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_1/explorer_e2e_3/handoff.md`

## Investigation Tasks
1. Inspect `test/` directory structure, existing test helpers, `test/lint.test.ts`, and any existing `test/e2e/` files.
2. Check how `test/lint.test.ts` scans files (does it scan `test/` too or only root / `src/`? What conventions or assertions does it enforce?).
3. Inspect existing tests that spawn subprocesses or create temp git repos to see established patterns, timeouts, cleanup practices, and Node/Bun compatibility considerations.
4. Check `.agents/teamwork/reviewer_INTEG-RUN-001/` (read-only) to understand why `bun test` touches 3 tracked files there and confirm E2E tests won't pollute the repo working tree.
5. Propose concrete directory/file layout for `TEST_INFRA.md` and `test/e2e/` (Tiers 1–4 Phase A tests + Phase B slots) covering all 20 features (`F01–F20`).
