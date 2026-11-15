# Explorer Handoff: `explorer_e2e_it2_3` (Flake Root-Cause Analysis for `syncResult.archify.length`)

- **Author:** `explorer_e2e_it2_3` (`teamwork_preview_explorer`)
- **Parent:** `sub_orch_e2e_2` (`901bf5689a93e28c0e0373e54199834f`)
- **Target:** `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` (line 136 `syncResult.archify.length`)
- **Status:** `COMPLETED` (Read-Only Investigation; zero repo source/test/config files modified)

---

## 1. Executive Summary & Root Cause

The transient `syncResult.archify.length === 0` failure observed by `reviewer_e2e_2` at `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts:136` during an overlapping `bun test` run (`reviewer_e2e_2/handoff.md:16`) is caused by a **non-atomic `${Date.now()}` temporary directory collision combined with an asynchronous `await` boundary inside `syncDiagrams()`**.

Specifically:
1. `f17_f20_telemetry_hygiene_docs.test.ts:96` constructs `sandbox` using millisecond-resolution `Date.now()`:
   ```ts
   const sandbox = join(tmpdir(), `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}diagrams-${Date.now()}`);
   ```
   followed by `mkdirSync(archDir, { recursive: true })` (line 98), which silently succeeds even if `archDir` already exists.
2. When two overlapping test runs (such as `reviewer_e2e_1` and `reviewer_e2e_2` executing `bun test` concurrently during Iteration 1) hit line 96 within the same millisecond (or race on the same directory), both processes operate on the identical `/tmp/cascade-e2e-sandbox-diagrams-<ms>` path.
3. In `f17_f20_telemetry_hygiene_docs.test.ts`, `discoverArchifyTargets(sandbox)` is first called synchronously at line 113 (`expect(targets.length).toBe(1)` passes). Then `syncDiagrams({ cwd: sandbox, archifyBin: "/usr/local/bin/archify", runner })` is awaited at lines 126–133.
4. Inside `syncDiagrams` (`diagrams.ts:207–290`), Graphify runs **before** Archify target discovery and yields across `await runner(graphifyCommand, cwd, timeoutMs)` (`diagrams.ts:225`). Only **after** that `await` does line 246 call `discoverArchifyTargets(cwd)` a second time.
5. If the overlapping run completes its test and executes `afterEach` -> `cleanupTempDir(sandbox)` -> `rmSync(sandbox, { recursive: true, force: true })` (or overwrites `candidate.json` via `writeFileSync`) while the current run is suspended at `diagrams.ts:225`, then `discoverArchifyTargets(sandbox)` at `diagrams.ts:246` sees `!existsSync(archifyDir)` (`diagrams.ts:75`) or a caught `JSON.parse`/`readdirSync` failure (`diagrams.ts:116–118`, `162–164`) and returns `[]`.
6. Because `syncDiagrams` treats `targets.length === 0` as a benign `"no_targets"` state (`diagrams.ts:247–248`), `overallSuccess` remains `true` (`syncResult.success === true` passes at line 135), while `syncResult.archify` is `[]` (failing line 136 with `Expected: 1, Received: 0`).

---

## 2. Production Code Trace (`diagrams.ts`)

Traced every line of `diagrams.ts` (`discoverArchifyTargets`, `resolveArchifyBin`, `buildArchifyCommand`, `syncDiagrams`):

### `discoverArchifyTargets(repoDir: string)` (`diagrams.ts:73-167`)
- **Inputs read:** ONLY `join(repoDir, CONSTANTS.ARCHIFY_DIR_NAME)` (i.e. `<repoDir>/.archify`, where `CONSTANTS.ARCHIFY_DIR_NAME = ".archify"` in `src/config/constants.ts:163,302`).
- **Does NOT read:** `os.homedir()`, `process.env.HOME`, `process.env.ARCHIFY_HOME`, `process.cwd()`, `~/.archify`, `~/.claude`, or `.agents/`.
- **All conditions returning `[]` (`syncResult.archify.length === 0`):**
  1. `!existsSync(archifyDir)` (`diagrams.ts:75`).
  2. `readdirSync(archifyDir, { withFileTypes: true })` throws (e.g. directory removed mid-scan; caught at `diagrams.ts:162-164`, returns `[]`).
  3. No subdirectory entry is a directory (`!entry.isDirectory()` at `diagrams.ts:83`) containing `candidate.json` or `candidate.archify.md`, AND root `<archifyDir>/candidate.json` is absent or invalid JSON.
  4. `candidate.json` fails `readFileSync` or `JSON.parse` (e.g., deleted or partially written/truncated concurrently; caught and silently ignored at `diagrams.ts:116-118` and `158-160`).

### `resolveArchifyBin(customBin?: string)` (`diagrams.ts:169-193`)
- Reads `process.env.ARCHIFY_BIN` (`:171`), `process.env.CASCADE_ARCHIFY_BIN` (`:174`), `Bun.which("archify")` (`:178`), and `homedir()` (`~/.hermes/skills/archify/bin/archify.mjs` at `:182`, `~/.local/bin/archify` at `:187`) **only when `customBin` is absent or blank**.
- In `f17_f20_telemetry_hygiene_docs.test.ts:118` and `:128`, explicit `bin` / `archifyBin: "/usr/local/bin/archify"` is supplied, so `resolveArchifyBin` short-circuits on `diagrams.ts:170` without touching env vars, `PATH`, or `homedir()`.

### `syncDiagrams(options: DiagramSyncOptions = {})` (`diagrams.ts:207-290`)
- `const cwd = options.cwd ?? process.cwd()` (`diagrams.ts:208`): explicitly overridden by `cwd: sandbox` (`f17_f20_telemetry_hygiene_docs.test.ts:127`), so `process.cwd()` is never consulted.
- `runGraphify` defaults to `true` (`:209`), executing `await runner(graphifyCommand, cwd, timeoutMs)` (`:225`) **before** `runArchify` (`:245`) calls `discoverArchifyTargets(cwd)` (`:246`).
- If `targets.length === 0` (`:247`), `syncDiagrams` logs `{ tool: "archify", status: "no_targets" }` (`:248`) and returns `{ success: true, graphify: ..., archify: [] }` (`:279-289`).

---

## 3. Cross-Test Concurrency & Environment Audit

Scanned all test files in `test/` and root `*.test.ts`:
- **`process.env` / `process.chdir` mutations:**
  - `grep -rn "process\.env\|process\.chdir"` across `test/` and `*.test.ts` shows zero `process.chdir` calls anywhere in the test suite.
  - Env mutations exist only in `test/pal/{claude,gemini,opencode}.test.ts` (API keys/base URLs), `test/sdd/sdd_gate.test.ts` (`CASCADE_SDD_GATE_DISABLED`), and `diagrams.test.ts:110-122` (`ARCHIFY_BIN`), each restored in `try/finally`. None of these affect `f17_f20_telemetry_hygiene_docs.test.ts` because `cwd: sandbox` and `archifyBin: "/usr/local/bin/archify"` are passed explicitly.
- **`mock.module` / `spyOn` / `CONSTANTS` mutations:**
  - Zero `mock.module` calls execute anywhere in `test/` or `*.test.ts` (`test/gates/gate3_scanner.test.ts:410` is only a string fixture fed to the anti-cheat scanner).
- **Other `${Date.now()}` temp-dir sites in `test/e2e/`:**
  - `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` lines **62** (`catalog-${Date.now()}`), **96** (`diagrams-${Date.now()}`), and **141** (`memory-${Date.now()}`).
  - `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts` lines **109** (`${Date.now()}`), **193** (`${item.expectedPm}-${Date.now()}`), and **208** (`empty-${Date.now()}`).
  - All other E2E tests (`f06_f09`, `tier2_boundaries`, `tier3_combinations`, `tier4_scenarios`, `helpers/temp_repo.ts`, `helpers/cli_runner.ts`) already use `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_*))`.

---

## 4. Baseline Verification Results (Read-Only)

Executed with `export PATH="$HOME/.bun/bin:$PATH"` in `/home/antigravity/sastiam/openspec-cascade`:

| Command | Exit Code | Observed Output |
|---|---|---|
| `bunx tsc --noEmit` | `0` | 0 TypeScript errors |
| `bunx eslint .` | `0` | 0 ESLint errors or warnings |
| `bun test test/e2e` | `0` | `64 pass`, `0 fail`, `347 expect() calls`, `Ran 64 tests across 14 files. [32.31s]` |
| `git status --short` (before & after `bun test test/e2e`) | `0` | Identical before and after (zero files added/modified by `test/e2e`) |

---

## 5. Deterministic Hardening Plan (Strictly Within `test/e2e/`)

Without modifying any production files (`diagrams.ts`, `src/**`, root `*.ts`):

1. **Eliminate `Date.now()` directory collisions in `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts`:**
   - Import `mkdtempSync` from `"node:fs"` at line 2.
   - Replace all three `${Date.now()}` temp paths with OS-atomic `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))`:
     - Line 62 (`outDir`): `const outDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));` (and remove redundant `mkdirSync(outDir, { recursive: true })` at line 63).
     - Line 96 (`sandbox`): `const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));` (keep `mkdirSync(archDir, { recursive: true })` at line 98 for `.archify/system-arch`).
     - Line 141 (`baseDir`): `const baseDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));` (and verify `MemoryStorage.initializeScaffolding()` still creates subdirs cleanly on an empty `mkdtempSync` directory).
2. **Harden cleanup & assertions in `f17_f20_telemetry_hygiene_docs.test.ts:95-138`:**
   - Wrap the `sandbox` lifecycle in `try { ... } finally { cleanupTempDir(sandbox); }` (or retain `cleanups.push(() => cleanupTempDir(sandbox))` + `afterEach`, and `try/finally` guarantees immediate per-test cleanup even if `afterEach` is bypassed).
   - Assert exact invariants after `syncDiagrams`:
     - `expect(syncResult.success).toBe(true)`
     - `expect(syncResult.graphify?.success).toBe(true)`
     - `expect(syncResult.archify.length).toBe(1)`
     - `expect(syncResult.archify[0]?.target).toBe("system-arch")`
     - `expect(executedCommands).toEqual([CONSTANTS.GRAPHIFY_COMMAND, cmd])` (or checking `executedCommands.length === 2` and both commands) — note `CONSTANTS` can be imported from `../../../config` if desired, or keep `executedCommands.length` + `cmd` check without changing test scope.
3. **Also replace `${Date.now()}` in `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts`:**
   - Lines 109, 193, 208 -> `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX))` (per `sub_orch_e2e_2/DISPATCH.md` item #3).
4. **Re-verify:** Run `bunx tsc --noEmit`, `bunx eslint .`, `bun test test/e2e`, and `bun test` (including concurrent stress check of `f17_f20_telemetry_hygiene_docs.test.ts` if desired).
