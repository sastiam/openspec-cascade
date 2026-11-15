# Dispatch: challenger_m1_2 (Adversarial CLI, Precedence, Stack Detection & Import-Safety Challenger)

- **Agent Type:** `teamwork_preview_challenger`
- **Role:** CLI & Loader Adversarial Challenger
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/challenger_m1_2`
- **Handoff Path:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/challenger_m1_2/handoff.md`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`

## Adversarial Challenge Scope
Write ephemeral Bun probe scripts / CLI invocations (clean up `/tmp` afterwards) to stress-test the REAL production modules (`src/config/loader.ts`, `config.ts`, `platform.ts`, `cascade.ts`):
1. **CLI Fail-Closed Exit Code `2`:**
   - Test `bun run cascade.ts` with `--unknown-flag`, `--engine invalid`, `--budget abc`, `--budget -1`, `--budget 0`, `--budget NaN`, `--budget Infinity`, `--budget ""`, `--total-budget 0`, `--usage-limit 0`, `--usage-limit 101`, `--usage-limit 1.5`, `--max-turns 0`, `--max-turns 2.5`, `--max-attempts 0`, `--mode v3`, `--config /nonexistent/file.json`, `--repo` (missing value), and verify exit code is strictly `2` and zero logs/side-effects occur.
2. **Import-Time Side-Effect Isolation:**
   - Import `cascade.ts` in a child process with invalid `process.argv` (`--unknown-flag`) and invalid env (`CASCADE_ENGINE=invalid`) -> verify importing `cascade.ts` does NOT throw or execute `loadConfig()` or `main()`.
3. **Layered Precedence & Malformed Config Files:**
   - Test every field across `overrides > CLI > CASCADE_* env > .openspec-cascade.json > defaults` (including empty env vars like `CASCADE_CHANGES=""`, `CASCADE_LOG_DIR=""`, `CASCADE_ENGINE=""`, boolean env vars `"true"`/`"false"`/`"invalid"`, malformed JSON in `.openspec-cascade.json`, unknown key in `.openspec-cascade.json`).
4. **Dynamic Stack Detection & Protected-Branch Dry-Run Guard:**
   - Test `loadConfig` + `verifyCommands` against temp repos with `package-lock.json` (`npm`), `pnpm-lock.yaml` (`pnpm`), `yarn.lock` (`yarn`), `bun.lock` (`bun`), and Nuxt (`nuxt.config.ts`).
   - Test `evaluateProtectedBranchGuard` and `cascade.ts --dry-run` on `main`/`master`/`stable` vs non-dry-run.
5. **Clean up `/tmp` temp dirs/scripts**, write exact findings + reproduction outputs + verdict (`CONFIRMED` or `REJECTED`) to `handoff.md`, and report via `send_message`.
