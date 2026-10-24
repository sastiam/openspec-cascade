# Proposal: Enrutador Autónomo, Escalera de 6 Peldaños y Sucesión

## Why

Garantiza que el sistema no se quede bloqueado reintentando el mismo error y renueva el contexto antes del desbordamiento.

## What Changes

- Implementar escalera de 6 peldaños en `src/core/escalation.ts`.
- Implementar protocolo de sucesión de orquestadores (16-spawn rule).
- Crear suite de pruebas unitarias en `test/core/escalation.test.ts`.

## Capabilities

### New Capabilities
- `core-router-escalation`: Gestiona el enrutamiento dinámico, resolución de fallos escalonados y relevo de orquestadores tras 16 spawns.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#19](https://github.com/sastiam/openspec-cascade/issues/19) (`LOOPER-CORE-004`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
