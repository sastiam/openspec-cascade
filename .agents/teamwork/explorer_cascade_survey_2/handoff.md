# Architectural & Codebase Survey Handoff: `openspec-cascade`

**Core Finding:** `openspec-cascade` currently has a **split-brain architecture** totaling 52,631 LOC across 59 TypeScript source files (plus 31,558+ LOC in `test/`): the live CLI orchestrator (`cascade.ts` + 10 root modules) runs a sequential task loop using `EngineAdapter` and `qa.ts`, while 47 of the 48 modules under `src/` (PAL, 18-state FSM, DAG scheduler, Subagent Dispatcher, 6-Rung Escalation, Gates 0–3, Memory Storage, SDD, GitHub/Catalog Integration) are completely orphaned from `cascade.ts` and lack a unified runtime/factory. Additionally, `config.ts`/`cascade.ts` hardcode Bun + Nuxt + Drizzle assumptions despite `platform.ts` already having package-manager detection, most subprocess runners hardcode `Bun.spawn` without a Node.js fallback, `eslint.config.js` lacks `no-explicit-any`, and `src/gates/*` / `src/integration/*` contain circular imports.

---

## 1. Observation

### 1.1 Repository & Toolchain Baseline
- `package.json:4-11`: Scripts are `"start": "bun run cascade.ts"`, `"test": "bun test"`, `"typecheck": "bunx tsc --noEmit"`, `"lint": "bunx eslint ."`, `"setup": "node bin/install.mjs"`; dependencies: `@anthropic-ai/claude-agent-sdk@^0.2.104`, `archify-cli@^1.0.0`, `eslint@^10.2.0`, `typescript@^5.9.3`, `typescript-eslint@^8.57.0`. No `zod` dependency exists (`rg -n "zod"` returned `no zod references`).
- `tsconfig.json:1-19`: Strict TypeScript (`"strict": true`, `"noUncheckedIndexedAccess": true`, `"moduleResolution": "bundler"`, `"noEmit": true`, `"include": ["**/*.ts"]`).
- `eslint.config.js:1-62`: Configures `@typescript-eslint/no-magic-numbers` (ignores `-1, 0, 1`, `*.test.ts`, `**/*.test.ts`) and `@typescript-eslint/explicit-module-boundary-types`. Does **not** enable `@typescript-eslint/no-explicit-any` or `tseslint.configs.recommended`.
- `lint.test.ts:91-98`: Only lints `await eslint.lintFiles(["*.ts"])` — does not include `src/**/*.ts`.
- Environment check (`which node`, `bun`): `/usr/local/bin/node` is `v24.22.2`; `bun` is not installed (`bun: command not found`) and `node_modules/` does not exist in `/home/antigravity/sastiam/openspec-cascade`.
- Source size (`wc -l *.ts src/**/*.ts src/**/**/*.ts`): **52,631 LOC** total. Largest files: `src/core/escalation.ts` (3,146), `src/pal/adapters/gemini.ts` (3,037), `src/integration/github_project.ts` (2,308), `src/core/dag.ts` (2,122), `src/pal/adapters/opencode.ts` (1,888), `src/storage/memory.ts` (1,797), `src/gates/gate3_audit.ts` (1,678), `src/pal/adapters/claude.ts` (1,676), `src/gates/gate2_challenger.ts` (1,574), `src/core/dispatcher.ts` (1,501), `src/gates/gate3_scanner.ts` (1,482), `src/pal/normalizer.ts` (1,420), `src/gates/gate1_review.ts` (1,344), `src/pal/adapters/jules.ts` (1,332).

### 1.2 Live Runtime Import Graph vs. Orphaned `src/` Modules
- `cascade.ts:26-67` imports **only** root modules: `./config`, `./engine` (`./antigravity`, `./claude`, `./opencode`), `./platform`, `./qa`, `./diagrams`, `./skills`, `./resilience`, and `./antigravity` (`describeToolInput`, `oneLine`).
- `resilience.ts:1-38` re-exports `./src/engine/rollback_buffer`.
- `rg -n "from [\"']\./|from [\"']\.\./" *.ts src/` confirms **zero** imports from root modules into:
  - `src/pal/*` (`types.ts`, `normalizer.ts`, `react_parser.ts`, `mcp.ts`, `adapters/claude.ts`, `adapters/gemini.ts`, `adapters/opencode.ts`, `adapters/jules.ts`)
  - `src/core/*` (`fsm.ts`, `fsm_types.ts`, `fsm_guards.ts`, `dag.ts`, `dispatcher.ts`, `escalation.ts`, `roles.ts`, `snapshot.ts`, `victory_livelock.ts`)
  - `src/gates/*` (`gate0_*`, `gate1_*`, `gate2_*`, `gate3_*`)
  - `src/storage/memory.ts`
  - `src/sdd/*` (`sdd_gate.ts`, `analyze.ts`, `review_verifier.ts`, `surface_verifier.ts`)
  - `src/integration/*` (`github_project.ts`, `catalog_generator.ts`, `drift_detector.ts`, `schema_validator.ts`, `errors.ts`)
- No `src/pal/factory.ts`, `src/config/`, `src/runtime/`, `src/decorators/`, `src/facade/`, or `test/e2e/` exist on `main`.
- `src/core/dispatcher.ts:764-966` (`SubagentDispatcher.dispatch()`) creates sandbox folders/files (`BRIEFING.md`, `DISPATCH.md`, `progress.md`, `handoff.md`) and `PalToolExecutionContext`, but does not invoke `IPalProvider`.
- `src/gates/gate1_review.ts:1005-1016`, `src/gates/gate2_challenger.ts:1181-1191`, and `src/gates/gate3_audit.ts:1412-1422` accept `provider: IPalProvider` and call `provider.executeTurn(...)`.

### 1.3 Duplication & Circular Dependencies
- **Dual adapter hierarchies:** `engine.ts:19-46` defines `EngineAdapter` implemented by root `claude.ts` (uses `@anthropic-ai/claude-agent-sdk` `query()`), `antigravity.ts` (spawns `agy`), and `opencode.ts` (spawns `opencode`). Meanwhile `src/pal/types.ts:521-549` defines `IPalProvider` / `ProviderAdapter` implemented by `src/pal/adapters/claude.ts` (direct HTTP `fetch` to Anthropic `/v1/messages`), `src/pal/adapters/gemini.ts` (`api` + `cli` modes), `src/pal/adapters/opencode.ts` (`api` + `cli` modes), and `src/pal/adapters/jules.ts` (`jules remote` CLI).
- **Duplicated helpers across root and `src/pal/adapters/`:**
  - `oneLine`, `describeToolInput`, `formatToolInput` exist in both `antigravity.ts:48-137` and `src/pal/adapters/gemini.ts:728-800+`.
  - `openCodeModelArg`, `openCodePermission`, `classifyFailure`/`classifyOpenCodeFailure` exist in both `opencode.ts:19-48` and `src/pal/adapters/opencode.ts:290-329`.
  - `sdd_gate.ts` (`src/sdd/sdd_gate.ts`) and `plugins/cascade/hooks/sdd_gate.mjs` duplicate production-file/active-change gating logic.
- **Circular / upward imports verified in `src/`:**
  - `src/gates/gate1_review.ts:55-64,1343-1344` <-> `src/gates/gate1_rubric.ts:19-27` <-> `src/gates/gate1_feedback.ts:37-47` (`gate1_feedback.ts:47` has a runtime import of `GATE1_RUBRIC_CONSTANTS` from `gate1_rubric.ts`).
  - `src/gates/gate0_qa.ts:15-37,573,593` <-> `src/gates/gate0_parser.ts:12` & `src/gates/gate0_policy.ts:16` (type-only back-edges).
  - `src/gates/gate2_challenger.ts:61-96` <-> `src/gates/gate2_synthesis.ts:29` & `src/gates/gate2_injector.ts:41`.
  - `src/gates/gate3_audit.ts:75-87,1654` <-> `src/gates/gate3_scanner.ts:32-36`.
  - `src/integration/catalog_generator.ts:33-62` <-> `src/integration/schema_validator.ts:15-22` & `src/integration/drift_detector.ts:27`.
  - `src/core/snapshot.ts:33` imports `../../resilience`, which re-exports `./src/engine/rollback_buffer` (upward edge from `src/core` to root).

### 1.4 Configuration, Stack Coupling & Runtime Portability
- `config.ts:19-83` hardcodes Nuxt/Bun/Drizzle literals in `CONSTANTS`: `TSC_SERVER = "bunx tsc --noEmit -p .nuxt/tsconfig.server.json"`, `TSC_APP = "bunx tsc --noEmit -p .nuxt/tsconfig.app.json"`, `NO_NEW_MIGRATION` (`bun run db:generate`), `DEFAULT_VERIFY = ["bun test", "bun run lint"]`, `QA_VERIFY_COMMANDS`, `DENIED_BASH` (`Bash(bun run db:push*)`, `Bash(bun run db:migrate*)`).
- `cascade.ts:195-217` (`verifyCommands()`) hardcodes `"bunx nuxi prepare"`, `CONSTANTS.TSC_SERVER`, `CONSTANTS.TSC_APP`, and `/^bunx? /`.
- `platform.ts:261-318` implements `detectPackageManager()` and `resolvePackageCommands()` for `bun | pnpm | npm | yarn`, but neither `config.ts` nor `cascade.ts` calls them.
- `cascade.ts:102` executes `export const config: CascadeConfig = loadConfig();` at module import time; `config.ts:293-336` uses `parseArgs({ strict: false })`, catches/swallows parse errors (`catch { return { options: {}, positionals: [] } }`), and does not validate numeric bounds (e.g., negative budgets, `usageLimitPercent > 100`).
- **Constants fragmentation & drift:** Almost every `src/` file defines its own `*_CONSTANTS` object (`CLAUDE_ADAPTER_CONSTANTS`, `GEMINI_ADAPTER_CONSTANTS`, `OPENCODE_ADAPTER_CONSTANTS`, `JULES_ADAPTER_CONSTANTS`, `ROLLBACK_CONSTANTS`, `FSM_CONSTANTS`, `DISPATCHER_CONSTANTS`, `ESCALATION_CONSTANTS`, `SUCCESSION_CONSTANTS`, `STORAGE_CONSTANTS`, `GATE0_CONSTANTS`..`GATE3_CONSTANTS`, etc.). Example drift: `config.ts:29` sets `RATE_LIMIT_SLEEP_MS = 1_800_000` (30 min), while `src/pal/adapters/gemini.ts:139` and `src/pal/adapters/opencode.ts:160` set `RATE_LIMIT_SLEEP_MS = 30_000` (30 sec); `config.ts:36` sets `DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.8-flash-high"` while `src/pal/adapters/gemini.ts:55` sets `"gemini-2.5-pro"`.
- **Subprocess & Bun lock-in:** Only `qa.ts:75-131` and `src/integration/github_project.ts:13` work on Node.js (`qa.ts` falls back to `node:child_process`). All other subprocess callers call `Bun.spawn` / `Bun.spawnSync` / `Bun.which` / `Bun.sleep` directly without Node fallback: `cascade.ts:143,285`, `antigravity.ts:278`, `opencode.ts:98`, `diagrams.ts:178`, `platform.ts:122,237-238`, `src/engine/rollback_buffer.ts:241`, `src/gates/gate0_qa.ts:364`, `src/gates/gate1_review.ts:790`, `src/gates/gate2_challenger.ts:577`, `src/gates/gate2_injector.ts:195`, `src/gates/gate3_audit.ts:541`, `src/pal/adapters/gemini.ts:1824`, `src/pal/adapters/opencode.ts:1036`, `src/pal/adapters/jules.ts:717`. Also `qa.ts:73,100` uses `["sh", "-c", cmd]` unconditionally (not `cmd.exe` on `win32`).

### 1.5 Clean Code, Strict Typing, Security & Packaging
- **`any` leaks:** `opencode.ts:55` (`Record<string, any>`), `antigravity.ts:98,198` (`Record<string, any>`), `src/pal/adapters/gemini.ts:1890,1914` (`proc.stderr as any`, `proc.stdout as any`), `platform.ts:34-36,174` (`...args: any[]`).
- **Inline comments inside function bodies:** Present across `cascade.ts`, `src/pal/normalizer.ts`, `src/pal/adapters/claude.ts`, `src/core/dispatcher.ts`, `src/core/dag.ts`, `src/engine/rollback_buffer.ts`, `src/gates/gate1_rubric.ts`, violating `.agents/skills/clean-code-best-practices/SKILL.md:12-15`.
- **Shell string interpolation risk:** `src/engine/rollback_buffer.ts:432,748,766-768` and `diagrams.ts:201-204` interpolate paths, refs, and commit messages into `sh -c` strings (e.g. ``git commit -m "${escapedMessage}"`` allows shell command substitution via `$()` or backticks).
- **Logging & self-attestation gaps:** `cascade.ts` writes raw tool inputs/outputs and stderr to JSONL logs with no secret redaction; when a task has no `verifyCommands`, `cascade.ts:563-568` relies on the agent editing `tasks.md` (`- [x]`).
- **OpenSpec & Packaging status:**
  - `rg -n "^\- \[ \]" openspec/changes/*/tasks.md` shows all changes checked off except `openspec/changes/looper-pal-jules-adapter/tasks.md:6` (task `1.2`).
  - `bin/install.mjs` + `.claude-plugin/marketplace.json` + `plugins/cascade/` were added in PR #43 (`70e2537`). `plugins/cascade/workflows/cascade-looper.mjs:18,24` still instructs agents to run `bun run cascade.ts`.

---

## 2. Logic Chain

1. **Why `cascade.ts` is disconnected from `src/` (Obs 1.2 & 1.3):** Each v2 subsystem (`looper-storage-memory`, `looper-pal-*`, `looper-core-*`, `looper-gate0..3`, `looper-integration-*`) was implemented in its own directory and unit-tested in isolation, with only `resilience.ts -> src/engine/rollback_buffer.ts` ever wired back into `cascade.ts`. Because `cascade.ts` still depends on `EngineAdapter` (root `claude.ts`, `antigravity.ts`, `opencode.ts`) rather than `IPalProvider`, `LooperFSM`, `DagScheduler`, `EscalationLadder`, and `Gate0..3`, none of the v2 orchestration, gates, or PAL features execute when running `openspec-cascade` or `run_looper.sh`.
2. **Why configuration and multi-runtime portability break (Obs 1.1 & 1.4):** `config.ts` evaluates `loadConfig()` at module import time with `strict: false`, hardcodes Nuxt/Drizzle/Bun commands, and is bypassed by `src/` modules that define independent `*_CONSTANTS`. Simultaneously, `qa.ts` gained a Node.js fallback in PR #42, but `cascade.ts`, `platform.ts`, `diagrams.ts`, `rollback_buffer.ts`, `gate*_*.ts`, and `src/pal/adapters/*` still call `Bun.spawn`/`Bun.which`/`Bun.sleep` directly, causing `node` execution to fail (as demonstrated in this container where `bun` is absent and `node v24.22.2` is present).
3. **Why architectural boundaries and clean-code gates drift (Obs 1.1, 1.3 & 1.5):** `lint.test.ts` only checks `*.ts` (ignoring `src/`), `eslint.config.js` omits `@typescript-eslint/no-explicit-any`, and `src/gates/*` / `src/integration/*` have mutual imports (including runtime constants imported across cycle boundaries). Unifying root + `src/` requires breaking those cycles, introducing a shared `ProcessRunner` / runtime abstraction, centralizing configuration with schema validation (e.g., `zod`) without import-time side effects, and consolidating `EngineAdapter` and `IPalProvider` behind a provider factory and unified looper runtime.

---

## 3. Caveats

- **Tests, typecheck, and lint were not executed dynamically:** `bun` is not installed in the current environment and `node_modules/` is not installed, so `bun test`, `bun run typecheck`, and `bun run lint` could not be run. All findings on types, imports, and code structure come from direct static inspection and ripgrep queries.
- **Partial deep-read of large `src/` files:** Core interfaces, constants, constructors, and entry points were read across `src/pal/*`, `src/core/*`, `src/gates/*`, `src/storage/*`, `src/sdd/*`, `src/integration/*`, and `src/engine/rollback_buffer.ts`, plus targeted `rg` scans across all 59 source files; not every line of the 52,631 LOC in `src/` was read line-by-line.
- **No `test/e2e` suite exists** to verify end-to-end orchestration across `LooperFSM` + `DagScheduler` + `SubagentDispatcher` + `IPalProvider` + `Gate0..3`.

---

## 4. Conclusion

The codebase has strong, well-tested building blocks in `src/`, but they are **not yet composed into a single working application** and suffer from **duplication, Bun/Nuxt coupling, and configuration fragmentation**. Recommend planning an evolutionary refactoring in 5 sequenced layers (without breaking existing CLI behavior):

1. **Runtime & Process Abstraction (`src/runtime/` + `platform.ts`):** Introduce a runtime-agnostic `ProcessRunner` interface (Bun when available, `node:child_process` fallback on Node 20+/24+, `win32`-safe `execFile`/argv execution without `sh -c` string interpolation for git commits/rollbacks), and replace direct `Bun.spawn`/`Bun.which`/`Bun.sleep` calls across `cascade.ts`, `platform.ts`, `diagrams.ts`, `rollback_buffer.ts`, `gate*_*.ts`, and `src/pal/adapters/*`.
2. **Centralized Config & Stack Detection (`config.ts` / `src/config/`):** Remove import-time `loadConfig()` side effects in `cascade.ts`, add schema validation (e.g., `zod` or strict validator) with strict CLI flag parsing, integrate `platform.ts`'s `detectPackageManager()`/`resolvePackageCommands()` so verification defaults are repo-aware (not hardcoded to Bun/Nuxt/Drizzle), and unify drifting constants (`RATE_LIMIT_SLEEP_MS`, default models, timeouts) between `config.ts` and `src/`.
3. **PAL Consolidation & Factory (`src/pal/factory.ts` + deprecate duplicate root adapters):** Unify `EngineAdapter` (`engine.ts` + root `claude.ts`/`antigravity.ts`/`opencode.ts`) and `IPalProvider` (`src/pal/adapters/*`), deduplicate `oneLine`/`describeToolInput`/`openCodeModelArg`/`openCodePermission`, fix `as any` casts in `gemini.ts`/`opencode.ts`/`antigravity.ts`, and note the semantic difference between Claude Agent SDK (`query()` multi-turn tool loop in root `claude.ts`) vs. stateless REST `ClaudeAdapter` (`src/pal/adapters/claude.ts`) so tool execution loops are preserved.
4. **Clean-Code, Cycle Breaking & Security Hardening:** Break circular imports in `src/gates/gate1_*`, `gate0_*`, `gate2_*`, `gate3_*`, `src/integration/catalog_*`, and fix `src/core/snapshot.ts -> ../../resilience` upward edge; add `@typescript-eslint/no-explicit-any` to `eslint.config.js` and include `src/**/*.ts` in `lint.test.ts`; add secret redaction to log hooks and budget/rate-limit enforcement decorators.
5. **Unified Looper Runtime & E2E Verification (`src/runtime/` / `src/facade/` + `test/e2e/`):** Wire `DagScheduler` -> `LooperFSM` -> `SubagentDispatcher` (connected to `IPalProvider`) -> `Gate0..3` -> `EscalationLadder` -> `RollbackStateBuffer` -> `MemoryStorage`, expose via a clean facade/CLI mode in `cascade.ts`, and add `test/e2e/` integration tests covering end-to-end runs and `jules` task `1.2` completion.

---

## 5. Verification Method

To independently verify every observation in this survey:
1. **Verify live vs. orphaned wiring:** Inspect `cascade.ts:26-67` and run:
   ```bash
   rg -n "from [\"']\./|from [\"']\.\./" *.ts src/
   ```
   Confirm `resilience.ts` is the only root file importing from `src/`.
2. **Verify toolchain & lint gaps:** Inspect `eslint.config.js:1-62`, `lint.test.ts:91-98`, and run:
   ```bash
   rg -n ":\s*any\b|\bas\s+any\b|<any>|any\[\]" *.ts src/
   rg -n "Bun\.spawn|child_process" *.ts src/
   ```
3. **Verify baseline tests/typecheck/lint (once `bun` and `node_modules` are installed):**
   ```bash
   bun install
   bun test
   bun run typecheck
   bun run lint
   ```
4. **Invalidation conditions:** Any commit on `main` adding `src/pal/factory.ts`, `src/runtime/`, `src/config/`, or wiring `LooperFSM`/`Gate0..3` into `cascade.ts` invalidates the "orphaned `src/`" observation.
