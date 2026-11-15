# Dispatch — `explorer_e2e_it2_3`

- **Role:** `teamwork_preview_explorer` (Read-Only Root-Cause Explorer for `syncResult.archify.length` Flake)
- **Parent:** `sub_orch_e2e_2`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` (read `## 2026-11-15T01:46:44Z`)
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Scope File:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2/SCOPE.md`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_e2e_2/explorer_e2e_it2_3/handoff.md`

## Investigation Tasks
1. Inspect `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` (entire file, especially lines 110–170 around line 136 `syncResult.archify.length`).
2. Trace the production implementation of the function called at line ~136 (likely `syncSkills` in `skills.ts` or similar) to understand EVERY condition under which `syncResult.archify.length` can be `0` vs `> 0`:
   - Does it read `os.homedir()`, `process.env.HOME`, `process.env.ARCHIFY_HOME`, `process.cwd()`, `~/.archify`, `~/.claude`, or `.agents/`?
   - Can another concurrently running test in `bun test` (e.g., unit tests in `test/`) mutate `process.env.HOME`, `process.cwd()`, or shared directories, or create a `Date.now()` collision?
   - Does `f17_f20_telemetry_hygiene_docs.test.ts` fail to restore `process.env` or `cwd`, or rely on implicit state affected by parallel test files?
3. With `export PATH="$HOME/.bun/bin:$PATH"`, run read-only verification (`bunx tsc --noEmit`, `bunx eslint .`, `bun test test/e2e`) to observe current baseline behavior (note `bun test` may touch `.agents/teamwork/reviewer_INTEG-RUN-001/`).
4. Propose a deterministic hardening fix strictly inside `test/e2e/` (Write Ownership forbids touching `src/` or root `*.ts`). Write complete root-cause evidence and fix plan to `handoff.md` and notify `sub_orch_e2e_2` via `send_message`.
