# Docs-only fast-track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `runTask` de v1 omita typecheck/test/build cuando la tarea solo tocó documentación.

**Architecture:** Un módulo puro `fast_track.ts` en la raíz (junto a `qa.ts`) detecta los ficheros afectados con git, decide si son solo docs y filtra la lista `verify`. `runTask` (`src/facade/cascade_facade.ts`) lo llama una vez antes de `runVerificationPhase`. Ante cualquier duda se ejecuta todo.

**Tech Stack:** TypeScript, Bun (`bun test`), `defaultCommandRunner` de `qa.ts`.

**Spec:** `docs/superpowers/specs/2026-11-16-docs-only-fast-track-design.md`

## Global Constraints

- Rama `feat/docs-only-fast-track`; nunca `main`; Conventional Commits con scope (`feat(fast-track): …`).
- Commits firmados: `git -c gpg.format=ssh -c user.signingkey=$HOME/.config/forja/agent-signing-sastiam -c user.name=Sebastian -c user.email=54696162+sastiam@users.noreply.github.com commit -S -m "…"`, con la línea final `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Push lo hace el usuario.
- No importar nada de `src/gates/*`. No tocar `qa.ts`, `src/facade/tasks.ts` ni `src/config/`.
- Sin números ni cadenas mágicas: constantes con nombre, locales al módulo (skill `no-magic-numbers`).
- Verificación final: `bun test`, `bunx tsc --noEmit`, `bun run lint`.

## Review Focus

- Ruta con espacios (`docs/my notes.md`) → docs-only, sin partirla.
- Solo un borrado de código (`src/a.ts` eliminado) → NO es docs-only.
- Renombrado `src/a.ts` → `docs/a.md` → NO es docs-only (cuentan las dos rutas).
- Extensión en mayúsculas (`README.MD`) → es docs.
- Directorio nuevo sin trackear con código dentro (`docs/x/y.ts`) → NO es docs-only.
- `runner` que lanza excepción → se ejecuta todo, sin propagar el error.

---

### Task 1: Detección de ficheros afectados

**Files:**
- Create: `fast_track.ts`
- Test: `fast_track.test.ts`

**Interfaces:**
- Consumes: `CommandRunner` y `defaultCommandRunner` de `./qa`; `CONSTANTS.COMMAND_TIMEOUT_MS` de `./config`.
- Produces:
  - `parseNulList(output: string): string[]`
  - `detectAffectedFiles(cwd: string, runner?: CommandRunner): Promise<string[] | undefined>` (runner por defecto `defaultCommandRunner`)

- [ ] **Step 1: Escribir los tests que fallan** en `fast_track.test.ts`:
  - `parseNulList("a.md\0b c.md\0")` → `["a.md", "b c.md"]`; `parseNulList("")` → `[]`.
  - `detectAffectedFiles` con runner falso: devuelve la unión de las salidas de `git diff --name-only -z --no-renames HEAD` y `git ls-files --others --exclude-standard -z` (el fake distingue por `command.startsWith`).
  - runner con `code: 1` en cualquiera de los dos → `undefined`; runner que lanza → `undefined`.
  - Test real en un repo temporal (`mkdtemp` + `git init`, un commit inicial, luego: modificar un `.md` trackeado sin stagear, crear `nuevo dir/x.md` sin trackear, `git mv src/a.ts docs/a.md` ya commiteado antes) usando `defaultCommandRunner`: las tres rutas esperadas aparecen, incluida `src/a.ts` y la de espacios, y ` M` sin stagear no se pierde (regresión del bug de v2).
- [ ] **Step 2:** Run `bun test fast_track.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3: Implementar** las dos funciones en `fast_track.ts`. Los comandos git son constantes con nombre. `detectAffectedFiles` ejecuta ambos con `CONSTANTS.COMMAND_TIMEOUT_MS`, comprueba `code === CONSTANTS.EXIT_CODE_SUCCESS`, y envuelve todo en `try/catch` devolviendo `undefined`.
- [ ] **Step 4:** Run `bun test fast_track.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(fast-track): detect affected files via git diff and ls-files`

### Task 2: Clasificación y selección de checks

**Files:**
- Modify: `fast_track.ts`
- Test: `fast_track.test.ts`

**Interfaces:**
- Consumes: nada de Task 1.
- Produces:
  - `type CheckKind = "typecheck" | "test" | "build" | "lint" | "other"`
  - `isDocsOnly(files: readonly string[] | undefined): boolean`
  - `classifyCheck(command: string): CheckKind`
  - `selectChecks(commands: readonly string[], files: readonly string[] | undefined, opts: { forceFull: boolean }): { run: string[]; skipped: string[] }`

- [ ] **Step 1: Tests que fallan:**
  - `isDocsOnly`: `["README.md", "docs/a.MDX", "LICENSE", "docs/my notes.md"]` → `true`; `[]` y `undefined` → `false`; `["a.md", "src/a.ts"]` → `false`; `["package.json"]`, `["bun.lock"]`, `["docs/img.png"]`, `["docs/x/y.ts"]` → `false`.
  - `classifyCheck`: `bunx tsc --noEmit` y `bun run typecheck` → `typecheck`; `bun test`, `bun run test:e2e`, `npx vitest run` → `test`; `bun run lint`, `eslint .` → `lint`; `bun run build` → `build`; `bun run latest`, `bun run attest`, `bun run db:generate`, `nuxt prepare` → `other`.
  - `selectChecks`: docs-only con `["bunx tsc --noEmit","bun test","bun run lint","bun run build","nuxt prepare"]` → `run: ["bun run lint","nuxt prepare"]`, `skipped` con los otros tres en orden; `forceFull: true` → todo en `run`; `files` con código o `undefined` → todo en `run`.
- [ ] **Step 2:** Run `bun test fast_track.test.ts` → FAIL.
- [ ] **Step 3: Implementar** las tres funciones. `isDocsOnly`: extensión en un `Set` de `.md .mdx .txt .rst` (minúsculas) o nombre base en minúsculas que empiece por `readme`, `license` o `changelog` y no tenga extensión de código. `classifyCheck`: trocear el comando en tokens `[a-z0-9]+` en minúsculas y mirar pertenencia exacta (prioridad typecheck, test, lint, build); tabla de tokens por tipo como constantes. `selectChecks` omite solo `typecheck|test|build` y solo si `isDocsOnly(files) && !opts.forceFull`.
- [ ] **Step 4:** Run `bun test fast_track.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(fast-track): classify checks and skip heavy ones for docs-only changes`

### Task 3: Función de orquestación con log

**Files:**
- Modify: `fast_track.ts`
- Test: `fast_track.test.ts`

**Interfaces:**
- Consumes: `detectAffectedFiles`, `selectChecks` (Tasks 1-2).
- Produces: `selectVerifyChecks(commands: readonly string[], opts: { cwd: string; forceFull: boolean; runner?: CommandRunner; say?: (message: string) => void; log?: (event: string, data: Record<string, unknown>) => void }): Promise<string[]>`

- [ ] **Step 1: Tests que fallan:** con runner falso docs-only → devuelve solo lint y llama `say` una vez con un mensaje que incluye `fast-track` y los comandos omitidos, y `log("fast_track", { skipped, files })`; sin omisiones → no llama `say` ni `log`; `commands` vacío → `[]` sin ejecutar el runner; runner que lanza → devuelve `commands` completo.
- [ ] **Step 2:** Run `bun test fast_track.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `selectVerifyChecks`: si `forceFull` o `commands` vacío, devolver `[...commands]` sin llamar a git; si no, `detectAffectedFiles` → `selectChecks` → emitir `say`/`log` solo si `skipped.length > 0` → devolver `run`.
- [ ] **Step 4:** Run `bun test fast_track.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(fast-track): add selectVerifyChecks orchestration with logging`

### Task 4: Enganche en `runTask` y verificación completa

**Files:**
- Modify: `src/facade/cascade_facade.ts` (bloque `if (verify.length) {…}` alrededor de las líneas 636-662; import nuevo de `../../fast_track`)
- Test: `test/facade/cascade_facade.test.ts`
- Modify: `docs/cli.md` (una nota breve en la sección de verificación, si existe; si no, en el README bajo "Verify")

**Interfaces:**
- Consumes: `selectVerifyChecks` (Task 3).
- Produces: nada nuevo.

- [ ] **Step 1: Test que falla** en `test/facade/cascade_facade.test.ts`, siguiendo el estilo de los tests existentes de ese fichero: una tarea con `Verify: \`bun test\`` cuya sesión (engine falso) solo modifica `docs/a.md` en un repo temporal → `runVerificationPhase` no se invoca / el comando `bun test` no se ejecuta y la tarea queda marcada `[x]`. Segundo test: la sesión modifica `src/a.ts` → `bun test` sí se ejecuta. Si el fichero no tiene arnés reutilizable para esto, escribir el test mínimo con los mismos dobles que ya usa.
- [ ] **Step 2:** Run `bun test test/facade/cascade_facade.test.ts` → FAIL en el primer test nuevo.
- [ ] **Step 3: Modificar** `runTask`: dentro de `if (verify.length)`, calcular `const checks = await selectVerifyChecks(verify, { cwd: ctx.config.repo, forceFull: ctx.config.fullGate || /\bfull verification\b/i.test(task.text), say: (m) => this.say(ctx, m), log: (e, d) => this.log(ctx, e, d) })` y ejecutar `runVerificationPhase` con `commands: checks` solo si `checks.length > 0`; si queda vacío, tratar la verificación como superada (sin `feedbackPrompt`) para que se ejecute el `markDone(tasksPath, task.id)` que sigue. `taskPrompt` sigue recibiendo `verify` completo.
- [ ] **Step 4:** Run `bun test test/facade/cascade_facade.test.ts` → PASS.
- [ ] **Step 5: Verificación completa:** `bun test` (todo verde), `bunx tsc --noEmit` y `bun run lint` sin errores. Si algo falla fuera de los ficheros tocados, comprobar en `main` si ya fallaba y reportarlo sin arreglarlo aquí.
- [ ] **Step 6: Documentar** la nota en `docs/cli.md`: qué se omite, cuándo, y que `fullGate` / "full verification" lo desactivan.
- [ ] **Step 7: Commit** `feat(fast-track): skip heavy checks for docs-only tasks in runTask` (más `docs(fast-track): …` si se separa la nota).

---

## Self-review

- Cobertura del diseño: detección (T1), `isDocsOnly`/`classifyCheck`/`selectChecks` (T2), log y reglas de seguridad (T3), integración en `runTask` y `forceFull` (T4). Sin flag de config ni imports de `src/gates` (Global Constraints).
- Tipos consistentes: `CommandRunner` viene de `qa.ts`; `selectChecks` devuelve `{ run, skipped }` y T3 lo consume igual.
- Aviso para el implementador: `defaultCommandRunner` hace `trim()` del stdout; por eso se usan `diff`/`ls-files` sin prefijo de estado (ver diseño).
