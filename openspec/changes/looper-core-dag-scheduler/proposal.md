# Proposal: Planificador de Tareas DAG y Resolutor Topológico de Dependencias

## Why

Las tareas de desarrollo tienen dependencias estrictas entre módulos y compuertas que deben planificarse antes del despacho.

## What Changes

- Implementar grafo acíclico dirigido y algoritmo de Kahn en `src/core/dag.ts`.
- Implementar detección de ciclos y agrupamiento por niveles independientes.
- Crear suite de pruebas unitarias en `test/core/dag.test.ts`.

## Capabilities

### New Capabilities
- `core-dag-scheduler`: Resuelve el orden topológico de tareas acíclicas garantizando ejecución sin deadlocks y paralelismo seguro.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#17](https://github.com/sastiam/openspec-cascade/issues/17) (`LOOPER-CORE-002`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
