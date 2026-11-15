# Design: Deterministic Forensic Audit Tooling

## Context

Regex-based audits produce false positives for fixture strings (for example `"export function bad(input: any)"` inside Gate 1 tests) and false negatives for comments embedded after code on the same line. The repository already depends on `typescript`, so the compiler API is available without new dependencies.

## Decisions

### Decision 1: AST-Driven Rules via the TypeScript Compiler API
- **Structure:** Parse each file with `ts.createSourceFile`. `explicit-any` reports `SyntaxKind.AnyKeyword` nodes. `inline-body-comment` walks every function-like node with a block body and reports leading/trailing comment ranges located strictly inside that body, excluding JSDoc (`/** ... */`). `e2e-stub` reports calls to `mock`, `mock.module`, `spyOn`, `jest.*`, `vi.*`, and identifiers matching `reference_pal`/`reference_spawner` inside `test/e2e/**`. `placeholder-implementation` reports `throw new Error("not implemented" | "TODO" | "stub")` in production files.
- **Rationale:** Comment and keyword detection on the AST ignores string and template literals, eliminating fixture false positives.

### Decision 2: Milestone-Scoped Audit Surface
- **Structure:** `FORENSIC_AUDIT_SCOPE` lists the directories and files owned by completed milestones (M1 config surface, E2E suite, and each new milestone module). Legacy v2 modules predating the constitution are added to the scope only once they are refactored.
- **Rationale:** Keeps the gate deterministic and green on approved work while preventing regressions as each milestone lands.

### Decision 3: Exit Codes from Centralized Constants
- **Structure:** The CLI exits with `EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS` or `EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR`.
- **Rationale:** Zero magic numbers.
