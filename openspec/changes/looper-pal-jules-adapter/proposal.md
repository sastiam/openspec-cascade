# Proposal: Adaptador Google Jules (Jules Tools CLI)

## Why

Jules es un agente de codificación asíncrono en la nube de Google. Integrarlo como proveedor PAL permite delegar tareas largas y paralelizables al looper sin consumir contexto local.

## What Changes

- Implementar `JulesAdapter` en `src/pal/adapters/jules.ts` implementando `ProviderAdapter`.
- Orquestar la CLI `jules remote new` / `remote list --session` / `remote pull --session` vía subproceso.
- Normalizar el ciclo de vida de la sesión remota (creada, en curso, completada, fallida) a eventos canónicos PAL.
- Crear suite de pruebas unitarias en `test/pal/jules.test.ts` con subproceso simulado.

## Capabilities

### New Capabilities
- `pal-jules-adapter`: Conecta el looper con Jules mediante sesiones remotas asíncronas (delegar, sondear, recuperar resultados), con soporte para `--parallel`.

### Modified Capabilities
<!-- None -->

## Impact

- **Reference GitHub Issue**: pendiente de asignar (`LOOPER-PAL-00X`)
- **Runtime Code**: `src/pal/adapters/jules.ts`
- **Tests**: `test/pal/jules.test.ts`
- **Dependencia externa**: `@google/jules` (`npm install -g @google/jules`)
