# Proposal: Adaptador Google Gemini y Antigravity con Streaming NDJSON

## Why

Garantiza el uso fluido de modelos Gemini Flash y Pro con subprocesamiento o llamadas directas en entornos Antigravity.

## What Changes

- Implementar `GeminiAdapter` en `src/pal/adapters/gemini.ts`.
- Normalizar eventos NDJSON y resolver invariantes de protobuf structs.
- Crear suite de pruebas unitarias en `test/pal/gemini.test.ts`.

## Capabilities

### New Capabilities
- `pal-gemini-adapter`: Conecta el looper con Google Gemini y la CLI Antigravity con soporte para 2M de contexto y streaming NDJSON.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#22](https://github.com/sastiam/openspec-cascade/issues/22) (`LOOPER-PAL-003`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
