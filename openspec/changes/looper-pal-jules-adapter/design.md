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

## Headless Authentication (task 1.2, reviewed 2026-11-15)

Sources: `https://jules.google/docs/cli/reference`, `https://jules.google/docs/cli/examples`, `https://developers.google.com/jules/api` and its v1alpha REST reference.

- **CLI (`@google/jules`, binary `jules`)**: authentication is interactive only — `jules login` opens a browser for Google sign-in, `jules logout` clears it. The documentation names no token-storage path, no environment variable and no non-interactive login flag. Consequence for the adapter: unattended runs require a pre-authenticated machine; a missing or expired login surfaces as `JulesAuthError` (stderr classified as auth failure), which `PalEngineBridge` maps to a `fatal` outcome so the cascade stops instead of retrying.
- **REST API (alpha)**: `https://jules.googleapis.com/v1alpha`, authenticated with an API key created at Jules Settings and sent in the `X-Goog-Api-Key` header (at most three keys). No environment-variable convention is documented. Endpoints: `POST /v1alpha/sessions` (body `prompt`, `sourceContext.source = sources/github/<owner>/<repo>`, `githubRepoContext.startingBranch`, optional `automationMode: AUTO_CREATE_PR`, `title`, `requirePlanApproval`), `GET /v1alpha/sessions`, `GET /v1alpha/sessions/{id}`, `GET /v1alpha/sessions/{id}/activities`, `POST .../{session}:approvePlan`, `POST .../{session}:sendMessage`, `GET /v1alpha/sources`.
- **Session states**: `STATE_UNSPECIFIED`, `QUEUED`, `PLANNING`, `AWAITING_PLAN_APPROVAL`, `AWAITING_USER_FEEDBACK`, `IN_PROGRESS`, `PAUSED`, `FAILED`, `COMPLETED` — consistent with the adapter's terminal (`COMPLETED`, `FAILED`) and awaiting-input (`AWAITING_*`) classification.
- **CLI commands confirmed**: `jules remote new --repo <owner/name|.> --session "<prompt>" [--parallel <n>]` (prompt may also be piped on stdin), `jules remote list --session` (flag takes no value), `jules remote pull --session <id>`.
- **Decision**: keep the CLI transport (already implemented and tested). A REST transport using `X-Goog-Api-Key` is the headless path for CI and is deferred until the API leaves alpha.
