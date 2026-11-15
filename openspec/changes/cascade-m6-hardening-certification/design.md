# Design: Milestone M6

## Decisions

### Decision 1: Allowlist Change Ids at the Configuration Boundary
- **Structure:** `ChangeIdSchema` (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` and not containing `..`) applies to every element of `changes`, so CLI, env and file inputs are all covered before any path is built.
- **Rationale:** One validation point protects the facade, pipeline, harness and analyzer.

### Decision 2: Reject, Don't Sanitize, Unsafe Verify Spans
- **Structure:** `isSafeVerifyCommand` rejects spans matching `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN`. Internal constants (e.g. `NO_NEW_MIGRATION`) are unaffected because they are not task-provided.
- **Rationale:** Escaping shell syntax is error-prone; tasks only need single commands.

### Decision 3: Alias-Aware Stub Detection
- **Structure:** Before walking calls, the auditor records local names bound to `mock`/`spyOn` from test-framework modules and treats calls to those names (and `<alias>.module`) as stubs.

### Decision 4: Tier 5 Uses Production Code Only
- **Structure:** Each probe imports production modules or spawns `cascade.ts`, `sdd_gate.{mjs,cjs}` and `git`; no mocks, stubs or reference harnesses. Process-tree probes use real `sh` children that trap `SIGTERM`.
