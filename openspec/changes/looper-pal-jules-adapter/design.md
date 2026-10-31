# Design: Adaptador Google Jules (Jules Tools CLI)

## Context

Referencia: https://jules.google/docs/cli/reference/. A diferencia de Claude/Gemini/OpenCode, Jules NO ofrece streaming: es un modelo asíncrono de sesiones remotas. El adaptador debe convertir ese modelo en la interfaz `ProviderAdapter` existente (ver `src/pal/types.ts`).

## Goals / Non-Goals

**Goals:**
- Adaptador tipado y desacoplado, siguiendo Clean Architecture y los patrones de `src/pal/adapters/*.ts`.
- Cobertura unitaria con `bun test`, sin llamadas reales a la CLI.
- Sin números mágicos (intervalos y timeouts como constantes configurables).

**Non-Goals:**
- Uso del TUI interactivo (`jules` sin argumentos).
- Integración con la REST API de Jules (posible cambio futuro).

## Decisions

### 1. Subproceso sobre `jules remote`
- **Choice**: `remote new --repo <repo> --session "<prompt>"` para crear; `remote list --session` para sondear; `remote pull --session <id>` para recuperar.
- **Rationale**: Es la superficie documentada para scripting. Nótese que `--session` en `new` recibe el prompt, y en `pull` recibe el ID.

### 2. Sondeo con backoff en lugar de streaming
- **Choice**: Tras crear la sesión, sondear su estado con intervalo y timeout inyectables; emitir eventos canónicos en cada transición.
- **Rationale**: La CLI no documenta streaming ni salida JSON.

### 3. Autenticación externa
- **Choice**: El adaptador no gestiona credenciales; verifica sesión iniciada (`jules login` previo) y falla con error tipado si no.

## Risks / Trade-offs

- **Riesgo**: La documentación no especifica formato de salida, códigos de salida ni comportamiento de `pull` (aplica parche, rama, árbol de trabajo).
- **Mitigación**: Aislar el parseo de stdout en un único módulo; tarea de verificación empírica con la CLI real antes de fijar los parsers; considerar REST API si la salida resulta inestable.
- **Riesgo**: Sin modo headless/CI documentado para autenticación.
- **Mitigación**: Documentar como prerrequisito; error claro si falta autenticación.
