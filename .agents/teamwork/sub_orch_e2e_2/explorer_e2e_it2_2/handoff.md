# Handoff — `explorer_e2e_it2_2` (Read-Only Temp Isolation & Cleanup Explorer)

- **Role:** `teamwork_preview_explorer`
- **Parent:** `sub_orch_e2e_2` (`901bf5689a93e28c0e0373e54199834f`)
- **Repository Root:** `/home/antigravity/sastiam/openspec-cascade`
- **Status:** COMPLETED (Read-Only Exploration)

---

## 1. Executive Summary

Inspected all 17 TypeScript files under `test/e2e/` (`helpers/` and `tier1_features/` through `tier4_scenarios/`).

- Found **6 non-atomic `${Date.now()}` temp directory constructions** across 2 Tier 1 test files:
  - `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts` (lines 109–111, 193–206, 208–210)
  - `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts` (lines 62–64, 96–99, 141–142)
- Verified **3 legitimate `Date.now()` uses** (timing/timestamp math, NOT temp paths) that must be kept:
  - `test/e2e/helpers/cli_runner.ts:128,158` (`startedAt` / `durationMs`)
  - `test/e2e/tier3_combinations/resilience_and_catalog_combinations.test.ts:104` (`staleIso`)
- Verified all remaining temp directory creations in `test/e2e/` already use `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_*))` (directly or via `createTempGitRepo` / `runCascadeCli` / `runNodeScript` / `runOpenSpecCli`) with deterministic cleanup via `afterEach` `cleanups` stack or `try/finally`.
- Verified baseline `bunx tsc --noEmit` and `bunx eslint test/e2e/` both exit `0`.

---

## 2. Exact `Date.now()` & Temp Directory Findings

### A. Non-Atomic Temp Directory Constructions to Replace (6 sites)

#### 1. `test/e2e/tier1_features/f01_f05_config_cli_lint.test.ts`

- **Imports (line 2):**
  - Current:
    ```ts
    import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
    ```
  - Recommended:
    ```ts
    import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
    ```
    (`mkdirSync` and `rmSync` are only used at lines 110, 194, 204, 209; replacing `rmSync` at line 204 with `cleanupTempDir` avoids unused imports.)

- **Site 1 — lines 109–111 (`loadConfig enforces precedence ...`):**
  - Current:
    ```ts
    const tempDir = join(tmpdir(), `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    cleanups.push(() => cleanupTempDir(tempDir));
    ```
  - Recommended:
    ```ts
    const tempDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(tempDir));
    ```

- **Site 2 — lines 192–206 (`detectPackageManager ...` loop):**
  - Current:
    ```ts
    for (const item of cases) {
      const dir = join(tmpdir(), `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}${item.expectedPm}-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      try {
        writeFileSync(join(dir, item.lockfile), "# lock\n", "utf8");
        const detected = detectPackageManager(dir);
        expect(detected).toBe(item.expectedPm);

        const commands = resolvePackageCommands(detected);
        expect(commands.test).toContain(item.expectedPm);
        expect(commands.run("custom")).toContain(item.expectedPm);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    ```
  - Issue: Non-atomic `${item.expectedPm}-${Date.now()}` (note `bun.lock` and `bun.lockb` share `item.expectedPm === "bun"` and run in the same millisecond).
  - Recommended:
    ```ts
    for (const item of cases) {
      const dir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
      try {
        writeFileSync(join(dir, item.lockfile), "# lock\n", "utf8");
        const detected = detectPackageManager(dir);
        expect(detected).toBe(item.expectedPm);

        const commands = resolvePackageCommands(detected);
        expect(commands.test).toContain(item.expectedPm);
        expect(commands.run("custom")).toContain(item.expectedPm);
      } finally {
        cleanupTempDir(dir);
      }
    }
    ```

- **Site 3 — lines 208–211 (`emptyDir`):**
  - Current:
    ```ts
    const emptyDir = join(tmpdir(), `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    cleanups.push(() => cleanupTempDir(emptyDir));
    expect(detectPackageManager(emptyDir)).toBe("npm");
    ```
  - Recommended:
    ```ts
    const emptyDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(emptyDir));
    expect(detectPackageManager(emptyDir)).toBe("npm");
    ```

#### 2. `test/e2e/tier1_features/f17_f20_telemetry_hygiene_docs.test.ts`

- **Imports (line 2):**
  - Current:
    ```ts
    import { existsSync, mkdirSync, writeFileSync } from "node:fs";
    ```
  - Recommended (`mkdirSync` is still needed at line 98 for `archDir` inside `sandbox`):
    ```ts
    import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
    ```

- **Site 4 — lines 62–64 (`schema_validator, TaskCatalogGenerator, and drift_detector ...`):**
  - Current:
    ```ts
    const outDir = join(tmpdir(), `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}catalog-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    cleanups.push(() => cleanupTempDir(outDir));
    ```
  - Recommended:
    ```ts
    const outDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(outDir));
    ```

- **Site 5 — lines 96–99 (`diagrams discovers Archify targets ...`):**
  - Current:
    ```ts
    const sandbox = join(tmpdir(), `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}diagrams-${Date.now()}`);
    const archDir = join(sandbox, ".archify", "system-arch");
    mkdirSync(archDir, { recursive: true });
    cleanups.push(() => cleanupTempDir(sandbox));
    ```
  - Issue: Non-atomic `${Date.now()}` path, plus `mkdirSync` ran before registering `cleanups.push(...)` (if `mkdirSync` failed partway, `sandbox` would leak).
  - Recommended (register cleanup immediately after `mkdtempSync`, before `mkdirSync(archDir, ...)`):
    ```ts
    const sandbox = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(sandbox));
    const archDir = join(sandbox, ".archify", "system-arch");
    mkdirSync(archDir, { recursive: true });
    ```

- **Site 6 — lines 141–142 (`MemoryStorage initializes teamwork layout ...`):**
  - Current:
    ```ts
    const baseDir = join(tmpdir(), `${E2E_CONSTANTS.TEMP_PREFIX_SANDBOX}memory-${Date.now()}`);
    cleanups.push(() => cleanupTempDir(baseDir));
    ```
  - Recommended:
    ```ts
    const baseDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    cleanups.push(() => cleanupTempDir(baseDir));
    ```

---

### B. Legitimate `Date.now()` Usages (Keep As-Is)

1. `test/e2e/helpers/cli_runner.ts:128,158` — measures subprocess `durationMs` (`const startedAt = Date.now()` / `Date.now() - startedAt`).
2. `test/e2e/tier3_combinations/resilience_and_catalog_combinations.test.ts:104` — computes `staleIso` (`new Date(Date.now() - 1_200_000).toISOString()`) for `HeartbeatWatchdog` stale threshold test.

---

### C. Full Temp Isolation & Cleanup Audit Across All Other `test/e2e/` Files

Every other file under `test/e2e/` already uses atomic `mkdtempSync` and deterministic cleanup:

- `test/e2e/helpers/cli_runner.ts`:
  - `runCascadeCli` (lines 170–187), `runNodeScript` (lines 198–217), `runOpenSpecCli` (lines 230–238): allocate `ownedHomeDir` via `mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_HOME))` and delete in `finally` via `rmSync(ownedHomeDir, { recursive: true, force: true })` (when helper owns `homeDir`).
- `test/e2e/helpers/temp_repo.ts`:
  - `createTempGitRepo` (lines 122–131, 194–197): allocates `repoDir`, `homeDir`, `logDir` via `mkdtempSync`; wraps `git init`/fixture setup in `try { ... } catch { cleanup(); throw error; }`.
- `test/e2e/tier1_features/f06_f09_runtime_pal_facade.test.ts`:
  - Line 79–80 (`mkdtempSync` + `cleanups.push(() => cleanupTempDir(sandbox))`), line 215–216 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 37–44).
- `test/e2e/tier1_features/f10_f13_greptile_review.test.ts`:
  - Line 79–80 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 13–20).
- `test/e2e/tier1_features/f14_f16_harness_v2_plugins.test.ts`:
  - Lines 37–52, 80–81, 115–116, 143–144 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 26–33).
- `test/e2e/tier2_boundaries/cli_config_boundaries.test.ts`:
  - Lines 29–30, 52–53, 78–79, 117–120, 150–154 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), lines 174–175 & 224–225 (`mkdtempSync` + `cleanups.push(() => cleanupTempDir(sandbox))`), drained by `afterEach` (lines 16–23).
- `test/e2e/tier2_boundaries/rollback_and_gate_boundaries.test.ts`:
  - Lines 30–33, 68–69, 85–86, 137–148, 179–180 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 19–26). Line 108 uses a pure non-existent string `"/tmp/gate1-boundary-check"` for boundary path validation without filesystem creation.
- `test/e2e/tier2_boundaries/sdd_and_review_boundaries.test.ts`:
  - Lines 26–27, 69–70, 113–114, 131–132, 202–203 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 13–20).
- `test/e2e/tier3_combinations/cli_stack_pm_combinations.test.ts`:
  - Lines 31–32, 126–127 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), lines 69–70 & 92–93 (`mkdtempSync` + `cleanups.push(() => cleanupTempDir(sandbox))`), drained by `afterEach` (lines 18–25).
- `test/e2e/tier3_combinations/resilience_and_catalog_combinations.test.ts`:
  - Lines 33–34, 93–94, 122–123 (`mkdtempSync` + `cleanups.push(() => cleanupTempDir(...))`), drained by `afterEach` (lines 22–29).
- `test/e2e/tier3_combinations/sdd_gates_pipeline_combinations.test.ts`:
  - Lines 31–32, 80–86, 183–184 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 20–27).
- `test/e2e/tier4_scenarios/dry_run_cascade_journey.test.ts`:
  - Lines 27–31, 87–88, 126–129 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 14–21).
- `test/e2e/tier4_scenarios/failure_rollback_audit_journey.test.ts`:
  - Lines 27–32, 96–97 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 14–21).
- `test/e2e/tier4_scenarios/installer_and_sdd_hook_journey.test.ts`:
  - Lines 24–25, 82–83 (`createTempGitRepo` + `cleanups.push(fixture.cleanup)`), drained by `afterEach` (lines 11–18).

---

## 3. ESLint, TypeScript & Clean Code Constraints for Replacements

1. **`tsconfig.json` (lines 6–12):**
   - `strict: true`, `noUncheckedIndexedAccess: true`, `types: ["bun"]`, `noEmit: true`.
   - `include` covers `test/**/*.ts`.
2. **`eslint.config.js`:**
   - Lines 20–36 (`**/*.ts`): `@typescript-eslint/no-explicit-any: "error"`, `@typescript-eslint/no-magic-numbers: "error"`, `@typescript-eslint/explicit-module-boundary-types: "error"`.
   - Lines 39–43 (`**/*.test.ts`): `@typescript-eslint/no-magic-numbers: "off"`, while `no-explicit-any` and `explicit-module-boundary-types` remain `"error"`.
   - Note: `f01_f05_config_cli_lint.test.ts:214–229` directly invokes ESLint on `test/e2e/helpers/*.ts` and `config.ts`, requiring zero errors and zero warnings.
3. **`openspec/project.md` Clean Code rule #4 (lines 39–42):**
   - Zero inline comments inside function bodies explaining *WHAT* the code does.
   - Zero `any` or `as any`.
4. **Baseline Verification Observed:**
   - Command: `export PATH="$HOME/.bun/bin:$PATH" && bunx tsc --noEmit && bunx eslint test/e2e/`
   - Exit code: `0` (clean, no errors or warnings).
