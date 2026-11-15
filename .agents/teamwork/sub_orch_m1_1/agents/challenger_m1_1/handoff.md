# Challenger M1-1 Verification Report (Guardrails, Redaction, Schemas & CLI)

- **Agent:** `challenger_m1_1` (`teamwork_preview_challenger`)
- **Verdict:** **REJECTED**
- **Target Modules Tested:**
  - `src/config/guardrails.ts`
  - `src/config/schemas.ts`
  - `src/config/constants.ts`
  - `src/config/loader.ts`
  - `config.ts`
  - `platform.ts`
  - `cascade.ts`

## Summary

Executed empirical adversarial probes (via ephemeral Bun scripts in `/tmp`, cleaned up after execution) against the real production modules and spawned `bun run cascade.ts` subprocesses.

- **Passed:** 70/74 probe cases + 6/7 targeted follow-up probes (all `enforceSessionBudget` boundary/NaN/Infinity checks, circular object/Array/Map/Set + diamond DAG redaction, PEM/URL/token pattern redaction, Zod numeric/boolean/strict-file schemas, malformed JSON rejection, dynamic `npm`/`pnpm`/`yarn`/`bun` lockfile detection, protected-branch `--dry-run` guard with zero log files, import-time side-effect check, and invalid CLI flags `--budget abc`, `--budget=-1`, `--budget 0`, `--budget NaN`, `--budget Infinity`, `--budget ""`, `--usage-limit 150`, `--usage-limit 0`, `--max-turns 0`, `--max-turns 1.5`, `--max-attempts=0`, `--unknown-flag` exiting `2` with zero side effects).
- **Rejected Due To 3 Reproducible Production Defects:**
  1. **`redactSensitiveData` prototype mutation / DoS on `__proto__` own property** (`src/config/guardrails.ts:256-263`)
  2. **`loadConfig` precedence inversion for `CASCADE_LOG_DIR` vs `.openspec-cascade.json` `logDir`** (`src/config/loader.ts:568-574`)
  3. **`loadConfig` / CLI `--repo ""` bypasses `nonEmptyStringSchema` and triggers side effects** (`src/config/loader.ts:523-528`)

---

## Failing Findings (Blocking — Must Fix)

### 1. `redactSensitiveData` mutates clone prototype via `cloned[key] = ...` when key is `"__proto__"`
- **Location:** `src/config/guardrails.ts:256-263` (`redactRecordValue`)
- **Root Cause:**
  `cloned[key] = ...` on a plain `{}` object triggers the `Object.prototype.__proto__` setter when `key === "__proto__"` (e.g., from `JSON.parse('{"__proto__": ...}')`). Instead of creating an own enumerable `"__proto__"` property on `cloned`, it mutates `Object.getPrototypeOf(cloned)` and drops `"__proto__"` from `Object.keys(cloned)` / `JSON.stringify(cloned)`.
- **Exact Reproduction:**
  ```ts
  const evil = JSON.parse('{"__proto__": {"toString": null, "valueOf": null, "secret": "sk-ant-1234567890"}}');
  const redacted = redactSensitiveData(evil);
  // Observed output:
  // JSON.stringify(redacted) === "{}"                       (own property "__proto__" lost)
  // String(redacted)         -> throws TypeError            (DoS via overridden prototype toString/valueOf)
  // (redacted as any).secret === "[REDACTED]"               (prototype of cloned object was mutated!)
  ```
- **Recommended Fix:** Use `Object.defineProperty(cloned, key, { value: nextVal, enumerable: true, writable: true, configurable: true })` (or skip/safely define `__proto__`) inside `redactRecordValue` (and similarly `redactErrorValue` if copying arbitrary entries).

### 2. `CASCADE_LOG_DIR` environment variable is overridden by `.openspec-cascade.json` `logDir`
- **Location:** `src/config/loader.ts:566-574` (`loadConfig`) & `src/config/loader.ts:181-185` (`resolveLogDir`)
- **Root Cause:**
  `loadConfig()` calls:
  ```ts
  resolveLogDir({
    option: cliOpts["log-dir"] ?? fileConfig.logDir,
    env: env.CASCADE_LOG_DIR,
    ...
  })
  ```
  Passing `fileConfig.logDir` as `option` causes `resolveLogDir` (`[option, env].find(...)`) to pick `.openspec-cascade.json`'s `logDir` ahead of `env.CASCADE_LOG_DIR`, violating the required precedence `CLI > CASCADE_* env > .openspec-cascade.json > defaults`.
- **Exact Reproduction:**
  ```ts
  // Repo has .openspec-cascade.json: { "logDir": "/tmp/from-file" }
  const cfg = loadConfig({ argv: ["--repo", repo], env: { CASCADE_LOG_DIR: "/tmp/from-env" }, cwd: repo });
  // Observed: cfg.logDir === "/tmp/from-file"
  // Expected: cfg.logDir === "/tmp/from-env"
  ```
- **Recommended Fix:** Pass `option: cliOpts["log-dir"]` and `env: env.CASCADE_LOG_DIR ?? fileConfig.logDir` (or add a dedicated `file?: string` parameter to `LogDirInput` checked after `env`).

### 3. `--repo ""` (empty string) bypasses `nonEmptyStringSchema("repo")` and produces side effects before failing
- **Location:** `src/config/loader.ts:523-528`
- **Root Cause:**
  When `--repo ""` is passed, `cliOpts.repo` is `""` (not `undefined`). `normalizePlatformPath("")` executes `normalize(resolve(""))`, which silently resolves to `process.cwd()`. `CascadeConfigSchema` then validates `repo = cwd` (a non-empty string) and succeeds, allowing `cascade.ts` to start `keepAlive`, create `.jsonl` log files in `logDir`, and run `preflight()` against `cwd`. (By contrast, `repo: ""` in `.openspec-cascade.json` is properly rejected with exit code `2`.)
- **Exact Reproduction:**
  ```bash
  bun run cascade.ts --repo "" --changes x --log-dir /tmp/probe-logs
  # Observed:
  # - Creates /tmp/probe-logs/<timestamp>.jsonl (side effect!)
  # - Runs keepAlive + preflight() on process.cwd()
  # - Fails with "STOPPED: Working tree is dirty..." instead of ConfigValidationError
  # Expected:
  # - Immediate fail-closed ConfigValidationError (exit code 2) with zero side effects / no log files created
  ```
- **Recommended Fix:** Validate explicit `overrides.repo`, `cliOpts.repo`, and `env.CASCADE_REPO` (when defined) as non-empty trimmed strings before calling `normalizePlatformPath(...)`, throwing `ConfigValidationError` on empty/whitespace values.

---

## Non-Blocking Observations (Informational)

1. **`Date` and `RegExp` at `maxDepth = 0`**: In `src/config/guardrails.ts:282-293`, `value instanceof Date` and `value instanceof RegExp` are checked before `depth >= maxDepth`, so `redactSensitiveData(new Date(0), 0)` returns a cloned `Date` rather than `"[MaxDepth]"`.
2. **`Error.cause` handling**: In `src/config/guardrails.ts:173-186`, `redactErrorValue` clones `message`, `stack`, and enumerable `Object.entries(err)`. Non-enumerable `err.cause` is omitted (so secrets in `cause` do not leak, though non-sensitive `cause` metadata is dropped).
3. **`--budget -1` CLI flag syntax**: Passing `--budget -1` (space-separated) is rejected by Node's `parseArgs` as an ambiguous option (`exitCode=2`, zero side effects), while `--budget=-1` reaches Zod and is rejected with `"Invalid maxBudgetPerSessionUsd: maxBudgetPerSessionUsd must be > 0"` (`exitCode=2`, zero side effects). Both fail closed cleanly with exit code `2`.

---

## Passing Verification Matrix

| Area | Test Case | Result | Observed Output |
|---|---|---|---|
| Import Side Effects | Import `cascade.ts` with toxic `process.argv` (`--unknown-toxic-flag --budget not-a-number`) | PASS | Zero throw, zero CLI execution |
| `enforceSessionBudget` | `NaN`, `-NaN`, `Infinity`, `-Infinity`, `-1` | PASS | Throws `BudgetExceededError` (`exitCode=2`) |
| `enforceSessionBudget` | `0`, `-0`, `maxBudgetUsd - 1e-12` | PASS | Allowed without throw |
| `enforceSessionBudget` | `spentUsd === maxBudgetUsd` (`10 === 10`, `150 === 150` total), `maxBudgetUsd + 1e-12` | PASS | Throws `BudgetExceededError` (`exitCode=2`) |
| `enforceSessionBudget` | Invalid `maxBudgetUsd` (`0`, `-5`, `NaN`, `Infinity`, `-Infinity`) | PASS | Throws `BudgetExceededError` (`exitCode=2`) |
| `redactSensitiveData` | Self-referencing object, mutual cycle (`a.b = b; b.a = a`) | PASS | Cycle replaced with `"[Circular]"`, secrets `"[REDACTED]"` |
| `redactSensitiveData` | Circular `Array`, `Set`, `Map` (key & value cycles) | PASS | Containers preserved (`Array`/`Set`/`Map`), cycles `"[Circular]"` |
| `redactSensitiveData` | Diamond DAG (shared non-circular sibling objects) | PASS | Both siblings preserved, zero false `"[Circular]"` |
| `redactSensitiveData` | `Date`, `RegExp`, `Error` (with circular extra prop & secret in message) | PASS | Types cloned & preserved, message/props redacted |
| `redactSensitiveData` | `Object.create(null)` | PASS | Preserves safe keys, redacts sensitive keys |
| `redactSensitiveData` | `maxDepth` (`0`, `-1`, `NaN`) | PASS | Returns `"[MaxDepth]"` for plain objects/containers |
| `redactSensitiveData` | PEM private key, URL `user:pass@host`, `sk-ant-`, `ghp_`, `Bearer` | PASS | All redacted cleanly |
| `CascadeConfigSchema` / Zod | `""`, `"   "`, `"NaN"`, `NaN`, `"Infinity"`, `"-Infinity"`, `Infinity`, `true`, `false`, `null`, `undefined`, `"0x10"`, `"1e1000"`, `-1`, `1.5` (int) | PASS | All rejected |
| `CascadeConfigSchema` / Zod | `"1e5"` (int -> `100000`), `"42"` (`42`), `usageLimitPercent` `0` (fail) / `1` (pass) / `100` (pass) / `100.1` (fail) | PASS | Expected bounds enforced |
| `CascadeFileConfigSchema` | Unknown keys at root, `sdd`, `greptile`, `telemetry` | PASS | All rejected (`strictObject` / `.strict()`) |
| Layered Config | File overrides defaults; env overrides file (`engine`, `budget`, `model`); CLI overrides env & file | PASS | Exact precedence preserved for these fields |
| Layered Config | Malformed JSON in `.openspec-cascade.json` & invalid `CASCADE_KEEP_ALIVE="maybe"` | PASS | Throws `ConfigValidationError` (`exitCode=2`) |
| Dynamic PM Detection | `package-lock.json` (`npm`), `pnpm-lock.yaml` (`pnpm`), `yarn.lock` (`yarn`), `bun.lock` (`bun`) | PASS | Correct `tryDetectPackageManager` & `resolvePackageCommands` |
| Protected Branch Guard | `evaluateProtectedBranchGuard` & `assertBranchSafety` on `main` vs `feat/*` + CLI on `main` (`--dry-run` vs non-dry-run) | PASS | Non-dry-run exits `2`; `--dry-run` exits `0` with zero log files |
| CLI Fail-Closed | `--budget abc`, `--budget=-1`, `--budget 0`, `--budget NaN`, `--budget Infinity`, `--budget ""`, `--usage-limit 150`, `--usage-limit 0`, `--max-turns 0`, `--max-turns 1.5`, `--max-attempts=0`, `--unknown-flag` | PASS | All exit `2` with zero log files created |
