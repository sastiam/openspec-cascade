# Proposal: Adaptador de Proveedor Anthropic Claude con Extended Thinking

## Why

Permite usar Claude de manera desacoplada aprovechando capacidades avanzadas de razonamiento sin romper la interfaz común.

## What Changes

- Implementar `ClaudeAdapter` en `src/pal/adapters/claude.ts`.
- Manejar prompt caching y tokens de razonamiento extendido.
- Crear suite de pruebas unitarias en `test/pal/claude.test.ts`.

## Capabilities

### New Capabilities
- `pal-claude-adapter`: Integra Claude Sonnet 3.7 con prompt caching, bloque de pensamiento y control de presupuestos.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#21](https://github.com/sastiam/openspec-cascade/issues/21) (`LOOPER-PAL-002`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
