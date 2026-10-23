# Proposal: Well-Architected Centralized Configuration & Engine Adapters

## Why

`cascade.ts` contains hardcoded literal values (magic numbers, timeouts, budget caps). Centralizing configuration in `config.ts` and adopting the Ports & Adapters pattern improves maintainability and testing.

## What Changes

- Create `config.ts` for typed configuration management with environment and CLI overrides.
- Refactor engine drivers to implement a unified `EngineAdapter` interface in `engine.ts`.
- Add linter rules preventing magic numbers and untyped exports.

## Definition of Done

- Zero magic numbers exist in core runner files (`cascade.ts`, `opencode.ts`, `antigravity.ts`).
- All engine drivers conform to the `EngineAdapter` interface.
