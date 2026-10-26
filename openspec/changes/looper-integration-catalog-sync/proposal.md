# Proposal: Generador de Catálogo Local de Tareas y Sincronizador Bidireccional

## Why

Mantiene un registro de auditoría versionado en el repositorio que documenta todas las tareas y sus enlaces oficiales.

## What Changes

- Implementar generador de catálogos en `src/integration/catalog_generator.ts`.
- Implementar detector de diferencias (drift) entre el repositorio y GitHub Project #4.
- Crear suite de pruebas unitarias en `test/integration/catalog.test.ts`.

## Capabilities

### New Capabilities
- `integration-catalog-sync`: Genera y actualiza localmente tasks_catalog.json y tasks_catalog.md para mantener coherencia entre GitHub y el repositorio.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#30](https://github.com/sastiam/openspec-cascade/issues/30) (`LOOPER-INT-003`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
