# Design: Milestone M4

## Decisions

### Decision 1: Break Cycles by Extracting Leaf Modules
- **Structure:** Types shared by a hub and its leaves move into dedicated modules with no runtime imports back into the family; hubs `export type { ... } from` the new modules so every existing import path keeps working. Catalog primitives (`CATALOG_CONSTANTS`, `CatalogTaskItem`, `CatalogTaskSection`, `extractTaskKey`, `normalizeCatalogItem`, `parseTaskBodySections`, `readCatalogJson`, `readCatalogJsonSync`) move to `catalog_model.ts`.
- **Exception:** `gate2_types.ts` and `gate3_types.ts` keep `import type` references to `Gate2AssertionInjector`/`TestingSandbox` and `Gate3AntiCheatScanner`, which appear in public options interfaces; replacing them with ports would break public accessors such as `getAssertionInjector()`. These erased edges are allowlisted explicitly in the architecture test.
- **Rationale:** Acyclic module graphs are required for deterministic initialization order under both Bun and Node ESM loaders, and type cycles hide layering violations.

### Decision 2: Sectioned, Deterministic Harness
- **Structure:** `InjectedHarness` contains ordered `sections` (`task`, `rules`, `artifacts`, `constitution`, `skills`, `greptile`, `remediation`, `guardrails`) each with an estimated token count; artifacts are truncated per-file to `HARNESS_CONSTANTS.MAX_ARTIFACT_CHARS`. Identical inputs produce byte-identical prompts.
- **Rationale:** Enables later self-improvement (M5) to inject bounded directives and makes prompt drift testable.

### Decision 3: The FSM Is the Single Source of Control Flow
- **Structure:** Every pipeline step dispatches the matching `LOOPER_EVENTS` transition; gate results map to events through each gate's `recommendedEvent`. Retries (`EVT_G0_RETRY`, `EVT_G1_REVISE`, `EVT_G2_BREAK`, `EVT_DIAGNOSTIC_RETRY`) re-enter `STATE_EXECUTE_WORKER` with the gate feedback or `routeFailure().enrichedPrompt`, bounded by `maxAttemptsPerTask`. Exhaustion goes `ESCALATE_DIAGNOSTIC → ROLLBACK_RECOVERY`; the rollback buffer restores the task baseline; non-resilient runs abort (`TaskFailureError`), resilient runs re-decompose and skip the task.
- **Rationale:** Uses the existing, tested transition matrix and livelock guards instead of a parallel ad-hoc loop.

### Decision 4: Workspace Artifacts Never Enter Commits
- **Structure:** Gate and dispatcher artifacts live in `.agents/teamwork/`; checkpoint commits exclude `.agents/teamwork/` and `.cascade/` in addition to `neverCommit`. Gate 2 runs with `preserveBreakingProbes: false` and its breaking probes become worker feedback.
- **Rationale:** Experiments show Gates 1–3 write sandbox artifacts and Gate 2 preserves repro tests under `test/` by default.

### Decision 5: Generated Hook Rules
- **Structure:** `sdd_rules.json` (`productionExtensions`, `exemptPathSegments`, `exemptNamePrefixes`, `exemptNameSuffixes`, `gatedTools`, `blockExitCode`, `disableEnv`) is generated from TypeScript constants; the `.mjs` and `.cjs` hooks read it relative to their own location and fall back to fail-open only when the file is missing.
- **Rationale:** One source of truth; the plugin stays dependency-free JavaScript runnable by any Node.
