# Proposal: Gate 2: Motor de Fuzzing y Desafío Adversarial Red-Team

## Why

Evita que los agentes implementen soluciones 'felices' que fallan ante entradas nulas, desconexiones o condiciones de carrera.

## What Changes

- Implementar motor de mutaciones y fuzzing en `src/gates/gate2_challenger.ts`.
- Ejecutar pruebas adversariales en sandboxes aislados.
- Crear suite de pruebas unitarias en `test/gates/gate2.test.ts`.

## Capabilities

### New Capabilities
- `gate2-adversarial-challenger`: Genera casos extremos, pruebas de fuzzing y aserciones adversariales para romper la solución antes de certificarla.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#26](https://github.com/sastiam/openspec-cascade/issues/26) (`LOOPER-GATE-003`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
