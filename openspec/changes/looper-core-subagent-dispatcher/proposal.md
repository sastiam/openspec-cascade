# Proposal: Despachador de Roles Cognitivos y Gestor de Sandboxes

## Why

Evita que subagentes interfieran entre sí en el sistema de archivos y permite especialización de contexto.

## What Changes

- Implementar matriz de 6 roles cognitivos en `src/core/roles.ts`.
- Implementar gestor de sandboxes y workspaces en `src/core/dispatcher.ts`.
- Crear suite de pruebas unitarias en `test/core/dispatcher.test.ts`.

## Capabilities

### New Capabilities
- `core-subagent-dispatcher`: Asigna roles cognitivos especializados (Explorer, Worker, Challenger, Auditor) con sandboxes de ejecución aislados.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#18](https://github.com/sastiam/openspec-cascade/issues/18) (`LOOPER-CORE-003`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
