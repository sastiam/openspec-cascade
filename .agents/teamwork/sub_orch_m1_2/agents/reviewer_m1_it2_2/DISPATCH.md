# Dispatch — `reviewer_m1_it2_2` (Independent Reviewer 2: Clean Code Rule #1, Typing, ESLint & Ownership)

- **Role:** `teamwork_preview_reviewer` (Read-only review + verification commands)
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/reviewer_m1_it2_2`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/reviewer_m1_it2_2/handoff.md`
- **Authoritative Request:** Read `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` verbatim.
- **Constitution & Prior Context:**
  - `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/SCOPE.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/worker_m1_it2_1/handoff.md`

## Review Scope
Independently verify (by inspecting actual diffs/AST/files and running commands yourself with `export PATH="$HOME/.bun/bin:$PATH"`):
1. **Clean Code Rule #1 (`openspec/project.md` Principle 4):** Run an AST/source scan and manually inspect ALL M1-created and M1-modified files — specifically `src/engine/rollback_buffer.ts`, `src/pal/adapters/{claude,gemini,opencode,jules}.ts`, `src/integration/github_project.ts`, `src/config/*`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `projects/agnostic_looper/verify_project_items.ts`, and M1 test files (`config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `engine.test.ts`, `lint.test.ts`, `test/config/*.test.ts`, `test/integration/github_project.test.ts`) — confirming ZERO inline `//` or `/* */` comments inside function bodies, zero dead/commented-out code, and zero accidental logic changes (e.g. `trimmed.startsWith("//")` in `gemini.ts` preserved).
2. **Strict Typing & Zero Magic Numbers:** Verify `@typescript-eslint/no-explicit-any: "error"`, `@typescript-eslint/no-magic-numbers: "error"`, `lint.test.ts` coverage across `src/**/*.ts`, and zero `any`/`as any` leaks.
3. **Write Ownership:** Verify `git status --short` shows ZERO modifications to forbidden files (`TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, `PROJECT.md`) and no `git commit`/`git push`. (Note: `bun test` touches 3 tracked files under `.agents/teamwork/reviewer_INTEG-RUN-001/` — expected.)
4. **Full Verification:** Run `bun run typecheck`, `bun run lint`, `bunx openspec validate cascade-m1-config-guardrails --strict`, and `bun test` yourself and verify exit code `0`.

Never modify repo files. Issue explicit verdict `APPROVE` or `REQUEST_CHANGES` in `handoff.md` and call `send_message` to your caller.
