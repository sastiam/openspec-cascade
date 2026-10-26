# Proposal: Esquema Canónico de Mensajes y Normalizador Bidireccional

## Why

Cada proveedor (Claude, Gemini, OpenAI/OpenCode) tiene formatos propietarios para tool calls, bloques de pensamiento y alternancia de turnos. Un esquema canónico previene fugas de abstracción.

## What Changes

- Crear interfaces TypeScript en `src/pal/types.ts`.
- Implementar normalizador bidireccional en `src/pal/normalizer.ts`.
- Implementar resolución de turn folding para alternancia estricta de turnos.
- Crear suite de pruebas unitarias en `test/pal/normalizer.test.ts`.

## Capabilities

### New Capabilities
- `pal-canonical-schema`: Define los tipos canónicos de mensajes, bloques de contenido y normalizador para desacoplar el motor de los proveedores de LLM.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#20](https://github.com/sastiam/openspec-cascade/issues/20) (`LOOPER-PAL-001`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
