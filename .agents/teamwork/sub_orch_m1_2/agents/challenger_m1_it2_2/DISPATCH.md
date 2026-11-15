# Dispatch — `challenger_m1_it2_2` (Adversarial Challenger 2: Layered Config Precedence & Fail-Closed CLI)

- **Role:** `teamwork_preview_challenger`
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/challenger_m1_it2_2`
- **Handoff Target:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/challenger_m1_it2_2/handoff.md`
- **Authoritative Request:** Read `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` verbatim.
- **Prior Findings & Context:**
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/challenger_m1_2/handoff.md`
  - `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_2/agents/worker_m1_it2_1/handoff.md`

## Adversarial Challenge Scope
Write and execute ephemeral adversarial probe scripts & real `bun run cascade.ts` subprocess invocations in `/tmp` (clean up all `/tmp` scripts and sandboxes before finishing!) against the REAL production `loadConfig` and CLI (`cascade.ts`). Always use `export PATH="$HOME/.bun/bin:$PATH"`.
Probe thoroughly:
1. **`logDir` 5-layer precedence:** `overrides.logDir > --log-dir > CASCADE_LOG_DIR > fileConfig.logDir > default`, including `CASCADE_LOG_DIR=""` / `"   "` falling back to `fileConfig.logDir`.
2. **Blank `CASCADE_CHANGES=""` / `"   \t "`:** Does NOT clobber `.openspec-cascade.json` `changes`, while `CASCADE_CHANGES="a,b"` overrides `fileConfig.changes`, and `--changes x` overrides `CASCADE_CHANGES`.
3. **Empty/whitespace explicit `repo` and `logDir` fail-closed with zero side effects:**
   - `--repo ""`, `--repo "   "`, `CASCADE_REPO=""`, `CASCADE_REPO="  "`, `overrides.repo: ""`, `--log-dir ""`, `--log-dir "   "`, `overrides.logDir: ""`, `--config ""` MUST throw `ConfigValidationError` and exit CLI with code `2` and `existsSync(logDir) === false`.
   - Verify `--repo <validDir>` when `CASCADE_REPO=""` is present STILL allows CLI `--repo` to win!
4. **Fractional `--usage-limit 1.5` & all numeric/invalid CLI flags fail-closed with exit code `2` and ZERO `logDir` creation:**
   - `--usage-limit 1.5 --changes demo --dry-run --log-dir <probeLog>` -> `exitCode === 2`, `logDirCreated === false`.
   - `--usage-limit 1.5 --log-dir <probeLog>` (with `--changes` omitted!) -> `exitCode === 2`, `logDirCreated === false`.
   - `CASCADE_USAGE_LIMIT_PERCENT="92.5"` and `.openspec-cascade.json` `{ "usageLimitPercent": 1.5 }` -> `ConfigValidationError` (`exitCode = 2`).
   - Also probe `--unknown-flag`, `--engine invalid`, `--budget abc`, `--budget=-1`, `--budget 0`, `--budget NaN`, `--budget Infinity`, `--max-turns 1.5`, `--max-turns 0`, `--max-attempts 0`, `--mode v3`.
5. **Import-time side-effect isolation & dynamic stack detection:**
   - Importing `cascade.ts` with toxic `process.argv` and invalid `CASCADE_*` env vars succeeds silently.
   - `npm`, `pnpm`, `yarn`, `bun`, `nuxt` lockfile detection via `loadConfig` + `verifyCommands`.

Never modify repository source/test/config/OpenSpec files. Issue explicit verdict `CONFIRM` or `REJECTED` in `handoff.md` and call `send_message` to your caller.
