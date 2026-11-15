# Dispatch: reviewer_m1_1 (Independent Architecture, Config, Guardrails & SDD Reviewer)

- **Agent Type:** `teamwork_preview_reviewer`
- **Role:** M1 Architecture & Guardrails Reviewer
- **Working Dir:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/reviewer_m1_1`
- **Handoff Path:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/agents/reviewer_m1_1/handoff.md`
- **Authoritative Request:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Master Project Doc:** `/home/antigravity/sastiam/openspec-cascade/PROJECT.md`
- **Constitution:** `/home/antigravity/sastiam/openspec-cascade/openspec/project.md`
- **Scope:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/sub_orch_m1_1/SCOPE.md`
- **Worker Handoff:** `/home/antigravity/sastiam/openspec-cascade/.agents/teamwork/worker_m1_1/handoff.md`

## Review Instructions
1. Do NOT modify any repository files; only write your `handoff.md`.
2. Independently read:
   - `openspec/changes/cascade-m1-config-guardrails/{proposal.md,design.md,specs/config-guardrails/spec.md,tasks.md}`
   - `src/config/{constants.ts,schemas.ts,guardrails.ts,loader.ts,index.ts}`
   - `config.ts`, `platform.ts`, `cascade.ts`
   - `test/config/*.test.ts`, `config.test.ts`, `platform.test.ts`, `cascade.test.ts`
3. Verify:
   - OpenSpec SDD `--strict` compliance (`SHALL`/`MUST` on first line of each requirement body, scenarios present, 100% task mapping & completion, `analyzeChangeArtifacts` passes).
   - F01: Zero magic numbers, typed immutable `as const` namespaces, backward-compatible `CONSTANTS`.
   - F02: Strict Zod schemas in `src/config/schemas.ts`, `zod` in `package.json` & `bun.lock`, strict finite-number coercion (no `z.coerce.number("") === 0` or `NaN` traps), fail-closed CLI exit code `2`.
   - F03: `enforceSessionBudget` (`NaN` rejected, strict `>=`), `redactSensitiveData` (`WeakSet` cycles, `maxDepth`, `Array`/`Map`/`Set`/`Date`/`RegExp`/`Error` preservation, token/PEM/URL redaction), protected-branch dry-run guard (`main`/`master`/`stable`).
   - F04: Layered precedence (`overrides > CLI > CASCADE_* env > .openspec-cascade.json > defaults`), `detectPackageManager`/`resolvePackageCommands` wired dynamically (no hardcoded Bun/Nuxt/Drizzle for arbitrary repos), zero import-time `loadConfig()` side effect in `cascade.ts`, backward-compatible exports (`CONSTANTS`, `CascadeConfig`, `buildConfig`, `resolveEngine`, `resolveLogDir`).
4. Independently run (with `export PATH="$HOME/.bun/bin:$PATH"`):
   - `bun run typecheck`
   - `bun run lint`
   - `bunx openspec validate cascade-m1-config-guardrails --strict`
   - `bun test`
5. Emit explicit verdict `APPROVE` or `REQUEST_CHANGES` with exact file:line citations in your `handoff.md`, then call `send_message`.
