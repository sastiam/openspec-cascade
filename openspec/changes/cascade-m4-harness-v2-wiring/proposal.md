# Proposal: Milestone M4 — Harness Injector, Import Hygiene, V2 Pipeline Wiring & Plugin Sync

## Why

The v2 modules (`analyze`, `sdd_gate`, `dag`, `fsm`, `dispatcher`, `gate0..3`, `escalation`, `rollback_buffer`, `memory`) are tested in isolation but never executed: `--mode v2` is parsed and ignored. Prompt assembly is a hard-coded function in the v1 path with no place for Greptile context, constitution or remediation directives. A static scan finds one runtime import cycle (`catalog_generator` ↔ `drift_detector` ↔ `schema_validator`) and five type-level cycles (`engine.ts` ↔ engine adapters, and each gate family's hub ↔ leaf modules). The Claude Code plugin hook `sdd_gate.mjs` duplicates SDD rules with literals that have drifted from `SDD_CONSTANTS` (missing `.rb`, `.php`, `.kt`, `/dist/`, `spec.` prefixes) and a hard-coded exit code.

## What Changes

1. **F14 — Import hygiene**: extract `src/engine/contract.ts` (engine port types), `src/integration/catalog_model.ts` (catalog primitives) and `src/gates/gate{0,1,2,3}_types.ts` (shared gate types); hubs re-export for compatibility. `test/architecture/import_cycles.test.ts` asserts zero cycles, including type-only edges.
2. **F14 — `src/core/harness_injector.ts`**: `HarnessInjector.buildExecutionContext(input)` deterministically assembles task instructions, OpenSpec artifacts (proposal, design, specs, tasks), constitution, skills/directives, Greptile context, guardrails and remediation directives into a sectioned, budgeted prompt (`InjectedHarness`).
3. **F15 — `src/facade/v2_pipeline.ts`**: `V2Pipeline` runs, per change, `analyzeChangeArtifacts` → `evaluateSddGate` → task DAG (`DirectedAcyclicGraph` + `topologicalSort`) → `LooperFSM` driving `SubagentDispatcher` (worker sandbox + briefing) → engine session → `Gate0MechanicalRunner` → `Gate1Reviewer` → `Gate2Challenger` (when a Bun runtime and code targets exist) → `Gate3Auditor` → checkpoint commit, with `routeFailure` escalation, `RollbackStateBuffer` recovery and `MemoryStorage` run state. `CascadeFacade` dispatches to it when `mode === "v2"`; `--mode v1` behavior is unchanged.
4. **F16 — Plugin sync**: `scripts/sync_plugin.ts` generates `plugins/cascade/hooks/sdd_rules.json` from `SDD_CONSTANTS`/`EXIT_CODE_CONSTANTS`; `sdd_gate.mjs` and a new CommonJS twin `sdd_gate.cjs` share one rule file and exit code; commands and workflow document `--mode v2` and the `jules`/`gemini` engines; `bin/install.mjs` verifies the hook bundle before registering the in-place plugin. A drift test fails when the generated file is stale.

## Definition of Done

- `bunx openspec validate cascade-m4-harness-v2-wiring --strict` exits `0`.
- Zero import cycles; `bun test`, `bunx tsc --noEmit`, `bunx eslint .`, the forensic audit and `npm run test:node` exit `0`.
- A real temp-repo run of `--mode v2` drives a task through Gates 0–3 to a checkpoint commit.
