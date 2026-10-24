# Proposal: Gate 3: Auditoría Forense de Integridad, Anti-Cheat y Buffer de Rollback

## Why

Garantiza que ninguna tarea sea marcada como completada mediante atajos o pruebas falseadas, revirtiendo el estado ante fraude.

## What Changes

- Implementar auditor forense en `src/gates/gate3_audit.ts`.
- Implementar detectores de trampas (stubs vacíos, mocks excesivos, omisión de tests).
- Integrar buffer de rollback Git atómico con snapshot previo a la ejecución.
- Crear suite de pruebas unitarias en `test/gates/gate3.test.ts`.

## Capabilities

### New Capabilities
- `gate3-forensic-audit`: Auditor final independiente con poder de veto binario, detección de trampas (stubs/auto-certificación) y rollback Git atómico.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#27](https://github.com/sastiam/openspec-cascade/issues/27) (`LOOPER-GATE-004`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
