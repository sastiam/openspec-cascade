# Proposal: Gate 0: Ejecutor de QA Mecánico Automatizado y Formateador de Trazas

## Why

Proporciona retroalimentación instantánea y determinista al agente antes de someter el código a revisión semántica.

## What Changes

- Implementar oráculo de ejecución en `src/gates/gate0_qa.ts`.
- Formatear trazas de error de TypeScript, Bun Test y ESLint en bloques XML para re-inyección.
- Crear suite de pruebas unitarias en `test/gates/gate0.test.ts`.

## Capabilities

### New Capabilities
- `gate0-mechanical-qa`: Oráculo mecánico de primera línea que ejecuta pruebas, comprobación de tipos y linters con feedback estructurado.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#24](https://github.com/sastiam/openspec-cascade/issues/24) (`LOOPER-GATE-001`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
