# EGM + openspec-cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir los tres momentos EGM (brainstorm, review, drift) alrededor del ciclo OpenSpec de cascade y un subcomando `spec-gate` que bloquea el `night-run` si las specs no están revisadas.

**Architecture:** Fase 1 son tres comandos Markdown en `plugins/cascade/commands/` que leen el `SKILL.md` instalado de EGM y sobrescriben las rutas de salida a `openspec/changes/<c>/`. Fase 2 es un subcomando `spec-gate` (`check` y `stamp`) con la lógica pura en `src/sdd/spec_marker.ts` y el despacho en `src/cli/spec_gate.ts`.

**Tech Stack:** TypeScript, Bun 1.4+ (`bun test`, `bun:test`), `node:util` `parseArgs`, `node:crypto`. Plugin Markdown de Claude Code.

**Spec:** `docs/superpowers/specs/2026-11-16-egm-cascade-integration-design.md`

## Global Constraints

- Rama `feat/egm-integration`, nunca `main`; el usuario hace el push (403 desde Claude). Commits Conventional con scope (`feat(plugin)`, `feat(spec-gate)`, `docs(cli)`), terminados con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Sin números ni cadenas mágicas: nombres de etapas, ficheros, algoritmo de hash y códigos de salida van en constantes con nombre (`SPEC_GATE_CONSTANTS`; reutilizar `EXIT_CODE_CONSTANTS`). Ver skill `no-magic-numbers`.
- TDD: test que falla primero, con `bun test <ruta>`. Al terminar cada tarea de código: `bun run typecheck` y `bun run lint` en verde.
- Salidas de EGM solo dentro de `openspec/changes/<c>/` (`brief.md`, `review.md`, `drift.md`). Nunca `docs/designs/` ni `concepts_brief.md` en la raíz.
- No tocar `src/config/loader.ts` ni `src/config/schemas.ts`, ni los gates de v2, ni `openspec-archive-change` (la genera el CLI de OpenSpec).
- Exit codes del subcomando: 0 correcto, 1 revisión ausente/abierta/caducada, 2 uso inválido (como el resto de subcomandos de `src/cli/commands.ts`).

## Review Focus

- Cascade marca `- [x]` en `tasks.md` durante `apply`: eso no debe caducar la revisión (hash con casillas normalizadas).
- Finales de línea CRLF o espacios finales no deben cambiar el hash.
- `review.md` existe pero sin bloque de estado (el agente olvidó el `stamp`): resultado "malformed", exit 1, no excepción.
- Nombre de change con `../` o mayúsculas: rechazar con exit 2, sin leer fuera de `openspec/changes/`.
- Varios changes en `--changes` con uno fallando: informar de todos los fallos, no solo del primero.

---

### Task 1: Lógica pura del marcador (`spec_marker`)

**Files:**
- Create: `src/sdd/spec_marker.ts`
- Test: `test/sdd/spec_marker.test.ts`
- Modify: `src/config/constants.ts` (añadir `SPEC_GATE_CONSTANTS`)

**Interfaces:**
- Produces:
  - `SPEC_GATE_CONSTANTS`: `STAGES = ["review", "drift"] as const`, `FILE_BY_STAGE = { review: "review.md", drift: "drift.md" }`, `STATUSES = ["resolved", "open"] as const`, `HASH_ALGORITHM = "sha256"`, `CHANGE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/`, `FRONT_MATTER_FENCE = "---"`.
  - `type SpecStage = "review" | "drift"`; `type SpecStatus = "resolved" | "open"`.
  - `computeChangeHash(changeDir: string): string`: sha256 hex sobre rutas relativas ordenadas y contenido de `proposal.md`, `design.md`, `tasks.md` y `specs/**/spec.md`; antes de hashear, `\r\n` → `\n` y `^(\s*-\s*)\[[xX]\]` → `$1[ ]`; ficheros ausentes se omiten.
  - `parseMarker(markdown: string): { stage: SpecStage; status: SpecStatus; hash: string } | undefined`: lee el bloque `---` inicial con las claves `egm`, `status`, `hash`; `undefined` si falta o es inválido.
  - `renderMarker(marker: { stage: SpecStage; status: SpecStatus; hash: string }): string`: bloque `---\negm: <stage>\nstatus: <status>\nhash: <hash>\n---\n`.
  - `evaluateStage(changeDir: string, stage: SpecStage): { ok: boolean; reason?: "missing" | "malformed" | "open" | "stale" }`.

- [ ] **Step 1: Escribir los tests que fallan** (`describe("spec_marker")`, directorios temporales con `mkdtempSync(join(tmpdir(), ...))`):
  - `computeChangeHash ignores task checkbox state`: mismo hash con `- [ ] a` y `- [x] a`.
  - `computeChangeHash ignores CRLF`: mismo hash con `\r\n` y `\n`.
  - `computeChangeHash changes when design.md changes`.
  - `parseMarker round-trips renderMarker`.
  - `parseMarker returns undefined without front matter`.
  - `evaluateStage` devuelve `missing` (sin `review.md`), `malformed` (sin bloque), `open` (status open), `stale` (hash distinto tras editar `design.md`), y `{ ok: true }` con status resolved y hash vigente.
- [ ] **Step 2:** `bun test test/sdd/spec_marker.test.ts`. Esperado: FAIL por módulo inexistente.
- [ ] **Step 3: Implementar** el módulo y las constantes con las firmas de Interfaces. El orden de lectura es el orden alfabético de rutas relativas para que el hash sea determinista.
- [ ] **Step 4:** `bun test test/sdd/spec_marker.test.ts && bun run typecheck && bun run lint`. Esperado: todo en verde.
- [ ] **Step 5: Commit** `feat(spec-gate): add change hash and review marker logic`.

---

### Task 2: Subcomando `spec-gate` (`check` y `stamp`)

**Files:**
- Create: `src/cli/spec_gate.ts`
- Test: `test/cli/spec_gate.test.ts`
- Modify: `src/config/constants.ts` (añadir `"spec-gate"` a `CLI_COMMAND_CONSTANTS.SUBCOMMANDS`), `src/cli/commands.ts` (una rama en `runSubcommand` que delega en `runSpecGate`)

**Interfaces:**
- Consumes: `computeChangeHash`, `evaluateStage`, `renderMarker`, `SPEC_GATE_CONSTANTS` (Task 1); `CliOutput` y `EXIT_CODE_CONSTANTS`.
- Produces: `runSpecGate(argv: readonly string[], output?: CliOutput): number`.
  - `spec-gate check --stage <review|drift> --changes <a,b> [--repo <ruta>]`
  - `spec-gate stamp --stage <review|drift> --change <a> --status <resolved|open> [--repo <ruta>]`: reescribe el bloque de estado al principio de `<change>/<review|drift>.md` (sustituye el existente o lo antepone) con el hash actual; si el fichero no existe, exit 2 con mensaje.

- [ ] **Step 1: Tests que fallan** (repo temporal con `openspec/changes/<c>/`; salida capturada con un `CliOutput` falso):
  - `check exits 0 when every change is resolved and fresh`.
  - `check exits 1 and reports every failing change` (dos changes fallando, ambos nombres en la salida).
  - `check exits 2 for a change name with path traversal` (`--changes ../x`) y para `--stage` desconocido.
  - `stamp then check round-trip`: tras `stamp --status resolved`, `check` da 0; tras editar `design.md`, da 1 con motivo `stale`.
  - `stamp exits 2 when review.md does not exist`.
  - `stamp replaces an existing block instead of stacking a second one`.
- [ ] **Step 2:** `bun test test/cli/spec_gate.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** `runSpecGate` con `parseArgs` en modo `strict` (mismo patrón que `parse()` de `src/cli/commands.ts`); validar cada nombre de change contra `CHANGE_NAME_PATTERN` antes de construir rutas; mensajes en inglés como el resto del CLI. Añadir la rama en `runSubcommand`.
- [ ] **Step 4:** `bun test test/cli/spec_gate.test.ts test/cli/commands.test.ts && bun run typecheck && bun run lint`. Esperado: verde, sin romper los tests de subcomandos existentes.
- [ ] **Step 5: Commit** `feat(spec-gate): add check and stamp subcommand`.

---

### Task 3: Comando `cascade-spec-review`

**Files:**
- Create: `plugins/cascade/commands/cascade-spec-review.md`
- Create: `test/plugin/egm_commands.test.ts`

**Interfaces:**
- Consumes: CLI `openspec-cascade spec-gate stamp` (Task 2).
- Produces: comando `/cascade-spec-review <change>`.

- [ ] **Step 1: Verificar el mecanismo de invocación** (spike manual, anotar el resultado en el commit): `ls ~/.claude/plugins/cache/egm/egm/*/skills/egm-review/SKILL.md` existe y se puede leer con `Read`. Decisión ya tomada: el comando localiza el `SKILL.md` más reciente con ese glob y sigue su procedimiento (las skills de EGM tienen `disable-model-invocation: true`, así que no se llaman con la herramienta Skill). Si el glob no encuentra nada, el comando se detiene y dice al usuario que instale `claude plugin install egm@egm`.
- [ ] **Step 2: Test que falla** en `test/plugin/egm_commands.test.ts`: para cada fichero de comando EGM (`cascade-spec-review.md`, y los de Tasks 4 y 5 cuando existan) comprobar que tiene frontmatter con `name` igual al nombre de fichero y `description` no vacía, que contiene la ruta de salida `openspec/changes/` y que no contiene `docs/designs/`. Este es un test de contenido sobre prompts; es la única comprobación posible para Markdown y se declara como tal.
- [ ] **Step 3:** `bun test test/plugin/egm_commands.test.ts`. Esperado: FAIL (falta el fichero).
- [ ] **Step 4: Escribir el comando.** Debe decidir, con este contenido mínimo: (a) argumento `<change>` obligatorio y comprobación de que `openspec/changes/<change>/design.md` existe; (b) localizar y leer el `SKILL.md` y los `agents/*.md` de EGM como arriba; (c) ejecutar la revisión con `design.md` como documento principal y `proposal.md`, `tasks.md` y `specs/*/spec.md` indicados como material referenciado; (d) escribir el informe en `openspec/changes/<change>/review.md` y no en el directorio de trabajo; (e) tras triar los hallazgos con el usuario, aplicar los arreglos de spec solo con `openspec-update-change` y, al terminar, ejecutar `openspec-cascade spec-gate stamp --stage review --change <change> --status resolved` (o `open` si quedan hallazgos sin resolver); (f) mencionar que `sdd-checklist` es la primera pasada barata.
- [ ] **Step 5:** `bun test test/plugin/egm_commands.test.ts`. Esperado: PASS.
- [ ] **Step 6: Commit** `feat(plugin): add cascade-spec-review command`.

---

### Task 4: Comando `cascade-spec-drift`

**Files:**
- Create: `plugins/cascade/commands/cascade-spec-drift.md`
- Modify: `test/plugin/egm_commands.test.ts` (añadir el fichero a la lista)

**Interfaces:**
- Consumes: igual que Task 3, con `--stage drift`.
- Produces: comando `/cascade-spec-drift <change>`.

- [ ] **Step 1:** Añadir `cascade-spec-drift.md` a la lista del test; ejecutarlo y ver FAIL.
- [ ] **Step 2: Escribir el comando** con el mismo mecanismo de localización que Task 3 apuntando a `egm-drift-report`. Documentos objetivo: `openspec/changes/<change>/specs/*/spec.md` y `design.md`. Mantener el formato estricto de EGM (solo diferencias, o `No drift detected`). Informe en `openspec/changes/<change>/drift.md`. Cerrar con `spec-gate stamp --stage drift`. Indicar que se ejecuta después de `apply` y antes de `/opsx-archive`.
- [ ] **Step 3:** `bun test test/plugin/egm_commands.test.ts`. Esperado: PASS.
- [ ] **Step 4: Commit** `feat(plugin): add cascade-spec-drift command`.

---

### Task 5: Comando `cascade-spec-brainstorm`

**Files:**
- Create: `plugins/cascade/commands/cascade-spec-brainstorm.md`
- Modify: `test/plugin/egm_commands.test.ts`

**Interfaces:**
- Produces: comando `/cascade-spec-brainstorm <change> <idea>`; escribe `openspec/changes/<change>/brief.md`.

- [ ] **Step 1: Verificar la compatibilidad con propose** (spike manual en un repo temporal con `openspec init`): ejecutar `openspec new change demo`, luego seguir el flujo de `openspec-propose` con ese nombre y comprobar que acepta un change ya existente. Si lo rechaza, parar y preguntar al usuario dónde guardar el brief; no improvisar otra ubicación.
- [ ] **Step 2:** Añadir el fichero a la lista del test; ejecutar y ver FAIL.
- [ ] **Step 3: Escribir el comando:** crea el change con `openspec new change <change>` si no existe (pidiendo confirmación antes del primer write); sigue `egm-brainstorm` leyendo su `SKILL.md` como en Task 3, con su regla de no lanzar subagentes hasta que el usuario confirme que está listo; el resumen va a `openspec/changes/<change>/brief.md` en lugar de `concepts_brief.md`; termina indicando `/opsx-propose` como siguiente paso y que `sdd-clarify` es la opción ligera para changes pequeños.
- [ ] **Step 4:** `bun test test/plugin/egm_commands.test.ts`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(plugin): add cascade-spec-brainstorm command`.

---

### Task 6: Documentación y traspaso al usuario

**Files:**
- Modify: `docs/cli.md` (sección nueva `spec-gate` en español, junto a los demás subcomandos), `README.md` (una línea en "How it works" que enlace a la sección), `docs/superpowers/specs/2026-11-16-egm-cascade-integration-design.md` (marcar estado "implementado")

- [ ] **Step 1:** Documentar en `docs/cli.md` los dos usos (`check` y `stamp`), los códigos de salida, el ciclo `brainstorm → propose → review → night-run → drift → archive` y el requisito de tener `egm@egm` instalado.
- [ ] **Step 2:** `bun test && bun run typecheck && bun run lint`. Esperado: verde. Si hay fallos previos al cambio (los 1953 tests de `TEST_READY.md` no están verificados), comparar contra `main` antes de atribuirlos a esta rama.
- [ ] **Step 3: Commit** `docs(cli): document spec-gate and the EGM cycle`.
- [ ] **Step 4: Traspaso (lo hace el usuario, fuera del repo):** pedir a `forja-maintain` que añada a la skill `night-run` la llamada `openspec-cascade spec-gate check --stage review --changes <lista>` antes del lanzamiento y que aborte si sale distinto de 0. La skill vive en `~/.claude/skills/night-run`, gestionada por forja, y el sandbox no la puede escribir. Después, `git push` de la rama `feat/egm-integration` por el usuario.
