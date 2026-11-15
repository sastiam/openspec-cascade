# Dispatch — `explorer_m1_it2_2` (Clean Code & Strict Typing Audit Explorer)

- **Role:** `teamwork_preview_explorer` (Read-only exploration)
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/explorer_m1_it2_2`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/explorer_m1_it2_2/handoff.md`
- **Authoritative Request:** Read `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` verbatim.
- **Constitution:** Read `/home/antigravity/sastiam/openspec-cascade/openspec/project.md` (especially Rules 2, 3, 4).
- **Toolchain Note:** Always run `export PATH="$HOME/.bun/bin:$PATH"` before `bun`/`bunx` commands.

## Objective
Audit ALL M1-created and M1-modified files for Clean Code Rule #1 (ZERO inline `//` or `/* */` comments inside function bodies, zero commented-out dead code, zero temporary tags), magic numbers, and strict typing:
1. Run `git status` and `git diff --name-only` (against HEAD / merge-base) to enumerate EVERY file created or modified in the workspace so nothing is missed. (Exclude `.agents/teamwork/` and `test/e2e/**` / `TEST_INFRA.md` / `TEST_READY.md` / `PROJECT.md` from M1 remediation scope, while noting them.)
2. Inspect specifically all files flagged by `reviewer_m1_2` and `DISPATCH.md`:
   - `src/engine/rollback_buffer.ts`
   - `src/pal/adapters/claude.ts`
   - `src/pal/adapters/gemini.ts`
   - `src/pal/adapters/opencode.ts`
   - `src/pal/adapters/jules.ts`
   - `src/integration/github_project.ts`
   - `src/config/constants.ts`, `src/config/schemas.ts`, `src/config/guardrails.ts`, `src/config/loader.ts`, `src/config/index.ts`
   - `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `engine.ts`
   - `src/gates/*` (any modified files)
   - `projects/agnostic_looper/verify_project_items.ts`
   - All M1 test files (`config.test.ts`, `platform.test.ts`, `cascade.test.ts`, `engine.test.ts`, `lint.test.ts`, `test/config/*.test.ts`, `test/integration/github_project.test.ts`)
3. For EVERY file with any inline comment inside a function body (or `TODO`/dead code/magic literal/`any`), record the exact file path, line number, verbatim comment text, and exact remediation (remove comment, or extract a self-documenting helper function / JSDoc if non-obvious WHY).
4. Inspect `eslint.config.js` and `lint.test.ts` to verify whether any lint rule or test already checks inline comments or `no-explicit-any` / `no-magic-numbers` across `src/**/*.ts`.

Write your findings to `handoff.md` in your working directory. Do NOT modify any repo files.
