# Proposal: Gate 1: Subagente Revisor Semántico de Código

## Why

El código puede compilar mecánicamente pero violar principios de diseño o inventar requisitos no solicitados.

## What Changes

- Implementar agente revisor semántico en `src/gates/gate1_review.ts`.
- Implementar rúbrica de evaluación objetiva de criterios de aceptación.
- Crear suite de pruebas unitarias en `test/gates/gate1.test.ts`.

## Capabilities

### New Capabilities
- `gate1-semantic-review`: Revisor independiente que valida Clean Code, adherencia a especificaciones y ausencia de números mágicos.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#25](https://github.com/sastiam/openspec-cascade/issues/25) (`LOOPER-GATE-002`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
