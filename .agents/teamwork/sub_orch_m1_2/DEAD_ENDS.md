# Dead Ends — `sub_orch_m1_2`

No dead ends recorded yet in Iteration 2.
Prior Iteration 1 root causes carried forward from `sub_orch_m1_1`:
- `resolveLogDir` option fallback `cliOpts["log-dir"] ?? fileConfig.logDir` inverted `CASCADE_LOG_DIR` vs `.openspec-cascade.json`.
- Raw `env.CASCADE_CHANGES` without `nonBlankEnv` caused `CASCADE_CHANGES=""` to clobber `fileConfig.changes`.
- `normalizePlatformPath("")` resolved `""` to `process.cwd()` before Zod `nonEmptyStringSchema("repo")` ran.
- `usageLimitPercent` lacked `int: true` in `EngineConfigSchema` and `loadConfig`.
- `cloned[key] = ...` in `redactRecordValue` triggered `Object.prototype.__proto__` setter instead of defining an own property.
- `BUDGET_CONSTANTS` zero/positive bounds were reused for non-USD durations and task/turn counts.
- Inline `//` comments inside function bodies persisted in 6 M1-modified `src/` files.
