# Integración de EGM (Elephant-Goldfish Model) en openspec-cascade

Estado: aprobado e implementado en la rama `feat/egm-integration` (2026-11-16). Pendiente de usuario: llamada a `spec-gate check` en `night-run` y push.

## Intención y porqué

OpenSpec sigue siendo el núcleo: la fuente de verdad son `openspec/changes/*` y `openspec/specs/*`. Cascade ejecuta `tasks.md`. EGM se añade alrededor de ese núcleo para cubrir tres problemas que el usuario reconoce:

1. Falta ideación estructurada antes de la propuesta.
2. Specs flojas producen tareas malas.
3. Nada verifica el resultado final contra la spec.

## Ciclo objetivo

```
idea ──► [1] brainstorm ──► openspec-propose ──► [2] review ──► (tú resuelves)
                                                                     │
                       night-run / cascade (apply, sin cambios) ◄────┘
                                     │
                                     ▼
                              [3] drift ──► openspec-archive
```

| Momento | Pieza de EGM | Salida (dentro del change) |
|---|---|---|
| 1. Antes de proponer | `egm-brainstorm` | `openspec/changes/<c>/brief.md` |
| 2. Antes de apply | `egm-review` | `openspec/changes/<c>/review.md` |
| 3. Antes de archive | `egm-drift-report` | `openspec/changes/<c>/drift.md` |

## Goals

- Los tres momentos disponibles como comandos en `plugins/cascade`, con las salidas dentro del change.
- Fase 2: un candado fino en v1 que impide arrancar el `night-run` con specs sin revisar, y avisa antes de archivar sin drift.

## Non-goals

- No meter goldfish como Gate 1 ni en ninguna parte del pipeline v2.
- No copiar (vendorizar) el código de EGM al repo; se usa el plugin instalado.
- No tocar el CLI de OpenSpec ni su schema `spec-driven`.
- No crear `docs/designs/` ni otro lugar de verdad para specs.

## Anti-goals (fracaso aunque "funcione")

- Una segunda fuente de verdad junto a `openspec/`.
- Aplicar hallazgos de los revisores sin que el usuario los triase.
- Goldfish corriendo desatendido dentro del loop nocturno.
- Añadir lógica a la parte de v2 que el plan de limpieza quiere reducir.

## Solape con las skills que ya existen en `plugins/cascade`

| Existente | Con EGM | Decisión |
|---|---|---|
| `sdd-clarify` (1-2 rondas de preguntas, 6 dimensiones) | `egm-brainstorm` (multi-turno + goldfish) | Complementarias. `sdd-clarify` por defecto; `egm-brainstorm` para changes grandes o arriesgados. |
| `sdd-checklist` (rúbrica PASS/FAIL, mismo contexto) | `egm-review` (contexto limpio) | `sdd-checklist` como primera pasada barata y mecánica; `egm-review` como segunda pasada. No es un sustituto: el mismo contexto no es un goldfish. |
| `sdd-verify` (verificación en runtime sobre el diff) | `egm-drift-report` (spec vs código) | Sin solape. Verifican cosas distintas. |

## Approaches

- A. Solo capa de skills/comandos. Barata, pero nada obliga a usarla.
- **B. A y después un candado fino en v1 (elegida por el usuario, en dos fases).**
- C. Goldfish como Gate 1 en v2. Descartada: choca con la poda de v2 y los revisores necesitan triaje humano.

## Fase 1: comandos (sin TypeScript)

Tres comandos en `plugins/cascade/commands/`: `cascade-spec-brainstorm`, `cascade-spec-review`, `cascade-spec-drift` (prefijo `spec-` porque `review` y `drift` ya son subcomandos de cascade con otro significado). Cada uno sigue el procedimiento de la skill de EGM correspondiente con estas sobrescrituras:

- Salida en la carpeta del change, no en el directorio de trabajo ni en `docs/designs/`.
- `cascade-review`: documento principal `design.md`; `proposal.md`, `tasks.md` y `specs/*/spec.md` se indican como material referenciado para los revisores. (Decisión del diseñador.)
- `cascade-drift`: los documentos objetivo son `specs/*/spec.md` y `design.md` del change; se mantiene el formato estricto de EGM (solo diferencias, o "No drift detected").
- Los hallazgos los triase el usuario; los arreglos de specs pasan por `openspec-update-change`.

Restricción técnica: las skills de EGM tienen `disable-model-invocation: true`, así que los comandos no pueden invocarlas con la herramienta Skill. Deben leer el `SKILL.md` instalado y los `agents/*.md`, o pedir al usuario que lance `/egm:egm-review`. Verificar cuál funciona con el plugin instalado (0.1.1) antes de elegir.

Requiere que el plugin `egm@egm` esté instalado y una sesión capaz de crear subagentes.

## Fase 2: candado fino en v1

- `review.md` y `drift.md` llevan un bloque de estado legible por máquina: `status: resolved|open` y un hash de los artefactos del change (proposal, design, tasks, specs). Si los artefactos cambian tras la revisión, el hash no coincide y la revisión se considera obsoleta.
- **Cambio tras leer el código (2026-11-16):** en vez del flag `--require-review`, el candado es un subcomando `openspec-cascade spec-gate` con dos acciones: `check` (sale con código 1 si falta, está abierto o caducó el marcador) y `stamp` (escribe el bloque de estado con el hash, que un agente no puede calcular fiablemente). Motivo: un flag nuevo obliga a tocar 7 puntos de `src/config/` (v2), mientras que `src/cli/commands.ts` ya es el punto de extensión de subcomandos. Es opt-in por naturaleza: solo se ejecuta si alguien lo llama.
- `night-run` debe llamar a `spec-gate check --stage review` antes de lanzar. Esa skill la gestiona forja (fuera del repo), así que es un paso del usuario.
- Antes de archivar se ejecuta `spec-gate check --stage drift`. No se modifica `openspec-archive-change`: la genera el CLI de OpenSpec y `openspec update` la sobrescribiría.
- El hash normaliza las casillas de `tasks.md` (`[x]` → `[ ]`) y los saltos de línea, porque cascade marca tareas durante `apply` y eso no debe invalidar la revisión.
- Alcance de código: `src/cli/spec_gate.ts`, `src/sdd/spec_marker.ts` (lógica pura), una entrada en las constantes de subcomandos y sus tests. Sin lógica de gates.

Pendiente de leer antes de implementar la fase 2: `plugins/cascade/hooks/sdd_gate_core.cjs`, que ya actúa como puerta y quizá sea el sitio natural para el marcador.

## Fuera de alcance de este documento / queda al implementador

- Texto exacto de los comandos y de los prompts de sobrescritura.
- Formato exacto del bloque de estado y del hash.
- Nombre del módulo del candado.

## Convenciones del repo

Trabajo en rama (p. ej. `feat/egm-integration`), nunca en `main`; Conventional Commits con scope; el push a `sastiam/*` falla desde Claude, así que lo hace el usuario.
