# Proposal: Adaptador OpenCode / Modelos Locales, Puente MCP y Parser ReAct

## Why

Permite usar modelos locales o de bajo coste con tolerancia a llamadas de herramientas mal formateadas vía parser ReAct.

## What Changes

- Implementar `OpenCodeAdapter` en `src/pal/adapters/opencode.ts`.
- Implementar parser ReAct fallback y auto-reparador de sintaxis JSON.
- Crear puente de herramientas Model Context Protocol (MCP).
- Crear suite de pruebas unitarias en `test/pal/opencode.test.ts`.

## Capabilities

### New Capabilities
- `pal-opencode-adapter`: Soporte para OpenCode y modelos locales (DeepSeek, Llama) con auto-reparación JSON y puente MCP.

### Modified Capabilities
<!-- None: Clean new capability in Agnostic Looper architecture -->

## Impact

- **Reference GitHub Issue**: [#23](https://github.com/sastiam/openspec-cascade/issues/23) (`LOOPER-PAL-004`)
- **Runtime Code**: `src/`
- **Tests**: `test/`
