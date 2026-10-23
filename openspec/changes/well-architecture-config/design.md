# Design: Centralized Configuration & Engine Adapters

## Context

Clean architecture requires separating configuration from execution logic and decoupling engine drivers via explicit interfaces.

## Decisions

1. **`config.ts`**: Single source of truth for runtime constants, configurable via process environment or CLI args.
2. **`EngineAdapter`**: Interface defining `runSession()`, `getDefaultModel()`, and `supportsPlanMeters()`.
