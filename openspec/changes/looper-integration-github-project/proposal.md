# Proposal: Servicio de Integración con GitHub Project #4 vía GraphQL y gh CLI

## Why

Permite que el looper sincronice automáticamente el avance con GitHub Project #4 sin intervención humana.

## What Changes

- Implementar `GitHubProjectService` en `src/integration/github_project.ts`.
- Soportar mutaciones tipadas para campos Status, Priority y Size.
- Crear suite de pruebas unitarias en `test/integration/github_project.test.ts`.

## Capabilities

### New Capabilities
- `integration-github-project`: Cliente de comunicación directa con GitHub Projects V2 para actualizar estados, prioridades y consultar tareas.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#29](https://github.com/sastiam/openspec-cascade/issues/29) (`LOOPER-INT-002`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
