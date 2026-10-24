# Proposal: Máquina de Estados Finita (FSM) del Motor Central y Livelock Prevention

## Why

El motor requiere un control determinista del ciclo de vida de ejecución para orquestar subagentes, compuertas de verificación y recuperación ante errores.

## What Changes

- Definir los 16 estados y matriz de transición en `src/core/fsm_types.ts`.
- Implementar la clase `LooperFSM` en `src/core/fsm.ts`.
- Implementar protocolo de prevención de livelock en la auditoría de victoria.
- Crear suite de pruebas unitarias en `test/core/fsm.test.ts`.

## Capabilities

### New Capabilities
- `core-fsm`: Implementa la FSM de 16 estados del looper con transiciones dirigidas por eventos y prevención de bloqueos.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#16](https://github.com/sastiam/openspec-cascade/issues/16) (`LOOPER-CORE-001`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
