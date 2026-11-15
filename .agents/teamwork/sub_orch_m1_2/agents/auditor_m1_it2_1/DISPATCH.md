# Dispatch — `auditor_m1_it2_1` (Forensic Integrity Auditor — Binary Veto)

- **Role:** `teamwork_preview_auditor` (NON-SKIPPABLE, BINARY VETO: `CLEAN` vs `DIRTY`)
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/auditor_m1_it2_1`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/auditor_m1_it2_1/handoff.md`
- **Authoritative Request:** Read `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` verbatim.
- **Prior Context & Reports to Read:**
  - `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/SCOPE.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/worker_m1_it2_1/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/reviewer_m1_it2_1/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/reviewer_m1_it2_2/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/challenger_m1_it2_1/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/challenger_m1_it2_2/handoff.md`

## Forensic Audit Mandate (Always `export PATH="$HOME/.bun/bin:$PATH"`)
Independently audit the repository for anti-cheat integrity, zero stubs/mocks, Clean Code compliance, write-ownership compliance, and full deterministic verification:
1. **Zero Cheating / Zero Stubs / Genuine Implementation:**
   - Inspect `src/config/{constants,schemas,guardrails,loader,index}.ts`, `config.ts`, `platform.ts`, `cascade.ts`, `src/engine/rollback_buffer.ts`, `src/pal/adapters/{claude,gemini,opencode,jules}.ts`, `src/integration/github_project.ts`, and `test/config/*.test.ts`.
   - Verify NO hardcoded test outputs, NO dummy/facade implementations, NO stub/mock reference harnesses in M1 tests or E2E tests, NO silenced assertions, NO weakened lint/tsconfig rules, and NO `@ts-ignore`/`@ts-expect-error`/`eslint-disable` bypasses.
2. **Clean Code Rule #1 & Strict Typing & Zero Magic Numbers:**
   - Run an independent TypeScript AST scan across ALL M1-created and M1-modified `.ts` files to verify ZERO inline `//` or `/* */` comments inside function bodies, ZERO `any` / `as any`, and ZERO uncentralized magic numbers in production source.
3. **Write-Ownership & Git Hygiene:**
   - Run `git status --short` and verify M1 Iteration 2 only modified authorized M1 files, did NOT touch `TEST_INFRA.md`, `TEST_READY.md`, `test/e2e/**`, `PROJECT.md`, and did NOT run `git commit` or `git push`. (Note: `bun test` touches 3 tracked files under `.agents/teamwork/reviewer_INTEG-RUN-001/` via `test/gates/gate1_feedback.test.ts` — expected, do not alter `.agents/teamwork/`.)
4. **Independent Full Verification Suite:**
   - Run `bun run typecheck` (must exit `0`)
   - Run `bun run lint` (must exit `0`, 0 warnings)
   - Run `bunx openspec validate cascade-m1-config-guardrails --strict` (must exit `0`)
   - Run `analyzeChangeArtifacts("cascade-m1-config-guardrails", process.cwd())` (must pass with `confirmedBlocking: 0`)
   - Run `bun test` (full suite — must exit `0`, 0 failures)

Do NOT modify any repository files. Issue an explicit binary verdict (`CLEAN` or `DIRTY`) with forensic evidence in `handoff.md` and call `send_message` to your caller.
