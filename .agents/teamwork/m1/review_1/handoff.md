# Milestone M1 Review Handoff (`review_1`)

**Verdict:** `REQUEST_CHANGES`
**Reviewer:** `teamwork_preview_reviewer` (`review_1`)
**Target:** Milestone M1 (`cascade-m1-config-guardrails`, Features F01–F05)

---

## Summary

The M1 implementation across `src/config/`, `config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `projects/agnostic_looper/verify_project_items.ts`, `eslint.config.js`, `lint.test.ts`, and `test/config/` is architecturally solid and passes all automated checks (`bun test`: 1757 pass / 0 fail; `tsc --noEmit`: 0 errors; `eslint .`: 0 errors, 0 warnings; `openspec validate cascade-m1-config-guardrails --strict`: valid; CLI fail-closed exit code `2` verified).

However, **6 M1-modified production files under `src/`** still contain inline `//` comments inside function bodies (and empty `catch` placeholders), violating:
- `openspec/project.md` Section 3 Principle 4 (Clean Code & Comments Rule: zero inline comments inside function bodies)
- `openspec/changes/cascade-m1-config-guardrails/specs/config-guardrails/spec.md` (`Strict TypeScript, ESLint No-Explicit-Any and Clean Code Compliance` — "enforce zero inline function-body comments in all M1-created and M1-modified files")
- `openspec/changes/cascade-m1-config-guardrails/tasks.md` Task `6.2` ("plus remove inline function-body comments across all M1-created and M1-modified files")

---

## Independent Verification Results

| Check | Command | Result |
|-------|---------|--------|
| OpenSpec Strict | `bunx openspec validate cascade-m1-config-guardrails --strict` | `PASS` (exit `0`) |
| Full Test Suite | `bun test` | `PASS` (`1757 pass, 0 fail, 8599 expect() calls across 65 files`) |
| TypeScript | `bun run typecheck` (`tsc --noEmit`) | `PASS` (exit `0`) |
| ESLint | `bun run lint` (`eslint .`) | `PASS` (exit `0`, 0 errors, 0 warnings) |
| CLI `--help` | `bun run cascade.ts --help` | `PASS` (exit `0`) |
| CLI `--unknown-flag` | `bun run cascade.ts --unknown-flag` | `PASS` (exit `2`) |
| CLI `--engine invalid` | `bun run cascade.ts --engine invalid` | `PASS` (exit `2`) |
| CLI `--budget -5` | `bun run cascade.ts --budget -5` | `PASS` (exit `2`) |
| CLI `--budget abc` | `bun run cascade.ts --budget abc` | `PASS` (exit `2`) |
| AST `any` scan | `grep -rnE ":\s*any\b\|\bas\s+any\b\|<any>" *.ts src/ projects/ test/` | `PASS` (0 actual AST `any` leaks; only string templates/regexes in gate/lint tests) |
| Write-boundary check | `git diff --stat HEAD -- TEST_INFRA.md TEST_READY.md test/e2e/ PROJECT.md` | `PASS` (0 changes to `sub_orch_e2e_1` / `main` artifacts) |

---

## Blocking Findings (`REQUEST_CHANGES`)

### 1. Inline `//` Comments Inside Function Bodies in M1-Modified `src/` Files

While all newly created M1 files (`src/config/*.ts`, `test/config/*.test.ts`) and root/project M1-modified files (`config.ts`, `platform.ts`, `cascade.ts`, `opencode.ts`, `antigravity.ts`, `projects/agnostic_looper/verify_project_items.ts`) have zero inline `//` comments, the following **6 M1-modified `src/` files** still contain inline `//` comments inside function bodies (contradicting `tasks.md` 6.2 and `worker_m1_1/handoff.md`):

1. **`src/engine/rollback_buffer.ts`** (16 inline function-body comments):
   - `src/engine/rollback_buffer.ts:249` (`// ignore kill failure` inside `defaultCommandRunner` empty `catch`)
   - `src/engine/rollback_buffer.ts:376`, `:407`, `:419`, `:424`, `:442`, `:464` (inside `rollbackWorkingTree`)
   - `src/engine/rollback_buffer.ts:542` (inside `RollbackStateBuffer.constructor`)
   - `src/engine/rollback_buffer.ts:630` (inside `RollbackStateBuffer.registerAuditLog`)
   - `src/engine/rollback_buffer.ts:661`, `:669`, `:676` (inside `RollbackStateBuffer.rollback`)
   - `src/engine/rollback_buffer.ts:738`, `:758`, `:776`, `:780` (inside `RollbackStateBuffer.commit`)

2. **`src/pal/adapters/claude.ts`** (14 inline function-body comments):
   - `src/pal/adapters/claude.ts:201`, `:210`, `:223` (inside `countCacheBreakpoints`)
   - `src/pal/adapters/claude.ts:324`, `:342` (inside `calculateClaudeTokenUsage`)
   - `src/pal/adapters/claude.ts:720`, `:755`, `:760`, `:796`, `:802`, `:819` (inside `ClaudeAdapter.buildTurnPayload`)
   - `src/pal/adapters/claude.ts:861` (inside `ClaudeAdapter.executeTurn`)
   - `src/pal/adapters/claude.ts:1222` (inside `ClaudeStreamChunkParser.feed`)
   - `src/pal/adapters/claude.ts:1518` (inside `ClaudeStreamChunkParser.handleMessageStop`)

3. **`src/pal/adapters/gemini.ts`** (27 inline function-body comments):
   - `src/pal/adapters/gemini.ts:633`, `:643`, `:671`, `:680` (inside `convertProtobufStructToJson`)
   - `src/pal/adapters/gemini.ts:764`, `:783`, `:789` (inside `describeToolInput`)
   - `src/pal/adapters/gemini.ts:972`, `:1008`, `:1025`, `:1033`, `:1041`, `:1052`, `:1067`, `:1075`, `:1104`, `:1128`, `:1186`, `:1235`, `:1248`, `:1288`, `:1314` (inside `reduceGeminiNdjsonEvent`)
   - `src/pal/adapters/gemini.ts:2325`, `:2350`, `:2374` (inside `GeminiAdapter.buildTurnPayload`)
   - `src/pal/adapters/gemini.ts:2783`, `:2804` (inside `GeminiStreamChunkParser.processParsedJson`)

4. **`src/pal/adapters/opencode.ts`** (6 inline function-body comments):
   - `src/pal/adapters/opencode.ts:783`, `:802`, `:881` (inside `OpenCodeStreamChunkParser.feedLine`)
   - `src/pal/adapters/opencode.ts:957`, `:968` (inside `OpenCodeStreamChunkParser.finalizeStream`)
   - `src/pal/adapters/opencode.ts:1535` (inside `OpenCodeAdapter.buildTurnPayload`)

5. **`src/pal/adapters/jules.ts`** (9 inline function-body comments):
   - `src/pal/adapters/jules.ts:865` (inside `JulesAdapter.runRemoteCommand`)
   - `src/pal/adapters/jules.ts:918` (inside `JulesAdapter.createSessions`)
   - `src/pal/adapters/jules.ts:1021` (inside `JulesAdapter.pollSessions`)
   - `src/pal/adapters/jules.ts:1213-1214`, `:1218`, `:1229` (inside `JulesAdapter.runBatchWave`)
   - `src/pal/adapters/jules.ts:1305` (inside `JulesAdapter.getCapabilities`)
   - `src/pal/adapters/jules.ts:1313` (inside `JulesAdapter.getRateLimitState`)

6. **`src/integration/github_project.ts`** (3 inline function-body comments):
   - `src/integration/github_project.ts:2051`, `:2081`, `:2104` (inside `GitHubProjectService.updateItemSize`)

**Required Action:** Remove all inline `//` comments inside function bodies across those 6 M1-modified `src/` files (and replace empty `catch { // ... }` placeholders with typed `catch (err) { void err; }` or appropriate handling where needed, matching `platform.ts:258` and `src/pal/adapters/gemini.ts:1878`), then re-run `bun test`, `bun run typecheck`, and `bun run lint`.

---

## Audit Highlights (Passing Areas)

- **F01 (`src/config/constants.ts`)**: 13 immutable `as const` namespaces + `DEFAULT_*_CONFIG` defaults cleanly unify drifting adapter/rollback constants and preserve `CONSTANTS` in `config.ts`.
- **F02 (`src/config/schemas.ts`)**: `strictFiniteNumberSchema` and `strictBooleanSchema` fail closed on `NaN`, `Infinity`, empty/whitespace strings, and booleans; `CascadeFileConfigSchema.strict()` rejects unknown config keys with `ConfigValidationError` (`exitCode = 2`).
- **F03 (`src/config/guardrails.ts`)**: `enforceSessionBudget` fails closed on `NaN`/non-finite/non-positive/`>=`; `redactSensitiveData` tracks active ancestors via `WeakSet` (`[Circular]`), caps depth (`[MaxDepth]`), preserves `Array`/`Map`/`Set`/`Date`/`RegExp`/`Error`, and redacts keys/tokens/PEM/URL credentials; `evaluateProtectedBranchGuard` blocks non-dry-run mutations on protected branches while allowing `--dry-run` preview with warning.
- **F04 (`src/config/loader.ts`, `platform.ts`, `cascade.ts`)**: Layered precedence (`overrides > CLI > env > .openspec-cascade.json > dynamic/repo defaults`), `strict: true` CLI parsing, lockfile-aware package manager detection (`hasLockfile`, `tryDetectPackageManager`, `isNuxtProject`), and lazy CLI config loading in `cascade.ts` (`runCli`) all behave as specified.
- **F05 (`eslint.config.js`, `lint.test.ts`)**: `@typescript-eslint/no-explicit-any: "error"` enabled, `.agents/**` ignored, all 15 AST `any` leaks eliminated, and `lint.test.ts` covers `src/**/*.ts`, `projects/**/*.ts`, `test/**/*.ts`, and `*.ts`.
