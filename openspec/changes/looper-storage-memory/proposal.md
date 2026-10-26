# Proposal: Jerarquía de Memoria Persistente en FS y Watchdog de Heartbeats

## Why

El Agnostic Looper requiere persistencia desacoplada entre sesiones de agentes para prevenir pérdida de estado en caídas de proceso y detectar agentes estancados.

## What Changes

- Crear módulo `src/storage/memory.ts` con manejo atómico de archivos y estructura de carpetas.
- Implementar guardián de secciones protegidas en BRIEFING.md.
- Implementar temporizador watchdog para detección de latidos (heartbeats).
- Crear suite de pruebas unitarias `test/storage/memory.test.ts`.

## Capabilities

### New Capabilities
- `storage-memory`: Implementa el sistema de almacenamiento en disco en .agents/teamwork/ con aislamiento de estado, protección de secciones y watchdog de latidos.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#28](https://github.com/sastiam/openspec-cascade/issues/28) (`LOOPER-INT-001`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
