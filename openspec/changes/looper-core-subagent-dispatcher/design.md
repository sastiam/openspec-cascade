# Design: Despachador de Roles Cognitivos y Gestor de Sandboxes

## Context

Implementation of LOOPER-CORE-003 as part of the Provider-Agnostic Multi-Agent Looper specification defined in `projects/agnostic_looper/SPECIFICATION.md`.

## Goals / Non-Goals

**Goals:**
- Provide a modular, decoupled TypeScript implementation adhering to Clean Architecture principles.
- Achieve comprehensive unit test coverage with `bun test`.
- Comply with zero-magic-numbers and strict typing directives.

**Non-Goals:**
- Out-of-scope external services or unmanaged network calls.

## Decisions

### 1. Hexagonal Modular Placement in `src/`
- **Choice**: Place modules in domain-specific subdirectories under `src/` and tests under `test/`.
- **Rationale**: Keeps responsibilities cleanly separated and eliminates monolithic root clutter.

### 2. Autonomous Verification
- **Choice**: Require explicit verification commands in `tasks.md` validating against `bun test`.

## Risks / Trade-offs

- **Risk**: Interface discrepancies with existing legacy modules.
- **Mitigation**: Canonical types and normalizers wrap and decouple legacy adapters.
