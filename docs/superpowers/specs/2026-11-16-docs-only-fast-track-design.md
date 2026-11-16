# Fast-track de verificación para cambios solo de docs (port v2 → v1)

Estado: pendiente de aprobación (2026-11-16). Rama: `feat/docs-only-fast-track`.

## Intención y porqué

v1 ejecuta todos los comandos `Verify:` de una tarea tras cada sesión, aunque la tarea solo haya tocado Markdown. En un `night-run` eso cuesta minutos y tokens de reintento por nada. v2 ya resuelve esto con `isFastTrackCandidate` (`src/gates/gate0_policy.ts`), pero v1 no puede depender de la maquinaria de gates de v2 (el plan de limpieza quiere podarla). Se porta solo lo útil, corrigiendo defectos.

## Goals

- Si una tarea solo cambió ficheros de documentación, `runTask` omite typecheck, test y build y lo dice en el log.
- Ante la duda, ejecutar todo.

## Non-goals

- No portar `evaluateGateExecutionPolicy`, eventos de FSM, modos de política, `verifyGate0FilesystemLayout` ni nada de gates 1-3.
- No tocar `qa.ts` ni `runChecks` en `src/facade/tasks.ts`.
- No importar desde `src/gates/*` (no acoplar v1 a v2).

## Anti-goals

- Saltarse comprobaciones por un error de detección. Un falso "solo docs" es peor que no tener fast-track.

## Approaches

- **A. Filtrar en `runTask` (`src/facade/cascade_facade.ts:588`), con un módulo puro nuevo. Elegida por el usuario.** Cambio mínimo, decisión visible en un único punto.
- B. Opción `affectedFiles` dentro de `runVerificationPhase` (`qa.ts`). Reutilizable, pero mezcla git en un módulo hoy puro y obliga a tocar `tasks.ts`.
- C. Portar la política de gate 0 entera. Descartada: arrastra FSM y gates que se quieren podar.

## Diseño

Módulo nuevo `fast_track.ts` en la raíz (junto a `qa.ts`) con su `fast_track.test.ts`. Sus piezas:

1. `parseNulList(output)`: rutas separadas por NUL, sin vacías. Revisión (2026-11-16, al escribir el plan): no se parsea `git status`, porque `defaultCommandRunner` hace `trim()` del stdout y eso borraría el espacio inicial de ` M fichero` (el bug de v2). En su lugar se usan dos comandos sin prefijo de estado.
2. `detectAffectedFiles(cwd, runner)`: ejecuta `git diff --name-only -z --no-renames HEAD` (staged + sin stagear; un renombrado sale como borrado + alta, así que cuentan las dos rutas) y `git ls-files --others --exclude-standard -z` (sin trackear, ya expandido a ficheros). Devuelve `string[]`; `undefined` si cualquiera falla.
3. `isDocsOnly(files)`: `true` solo si la lista no está vacía y todas las rutas son documentación: extensión `.md`, `.mdx`, `.txt` o `.rst` (sin distinguir mayúsculas), o nombre `LICENSE`/`README*`/`CHANGELOG*` sin extensión. Todo lo demás (código, `package.json`, lockfiles, config, imágenes, rutas desconocidas) lo hace `false`.
4. `classifyCheck(command)`: `typecheck | test | build | lint | other`, por tokens de palabra y no por subcadena (`latest` no es `test`).
5. `selectChecks(commands, files, opts)`: si `isDocsOnly` y no `opts.forceFull`, quita `typecheck|test|build`; conserva `lint` y `other`. Devuelve `{ run, skipped }`.

Integración en `runTask`: tras la sesión y antes de `runVerificationPhase`, si la tarea no es "full verification" y `ctx.config.fullGate` no está activo, se llama a `detectAffectedFiles` + `selectChecks`; se emite un `say`/`log` con los comandos omitidos y se verifica solo `run`. Si `run` queda vacío, no se llama a `runVerificationPhase`.

Reglas de seguridad: lista vacía, `git` con error o `undefined` → se ejecuta todo.

## Tests (TDD)

Casos mínimos: modificado sin stagear, staged, sin trackear en directorio nuevo, renombrado `.ts`→`.md`, borrado de código, ruta con espacios; mezcla md + ts → no docs-only; lista vacía → no docs-only; `latest`/`attest` no son test; `forceFull` nunca omite; git que falla ejecuta todo.

## Decisiones propias (el usuario puede corregirlas)

- Ubicación en la raíz, no en `src/`, siguiendo el layout de v1.
- Reimplementar la detección de docs en vez de importar de `src/gates/gate0_policy.ts`.
- Lint se conserva en docs-only porque puede cubrir Markdown.
- Sin flag de configuración nuevo: tocar `src/config/` cuesta 7 puntos (v2). Si hace falta desactivarlo, `fullGate` ya lo hace.

## Queda al implementador

- Nombres de constantes y su ubicación (regla `no-magic-numbers`).
- Lista exacta de extensiones y nombres de documentación.
