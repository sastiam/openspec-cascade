# Validación de la 0b con `tasks-lint`

Objetivo: recorrer el ciclo completo con un ticket real pequeño y anotar la fricción de cada paso. Es la materia prima del diseño de la pieza 2.

Worktree: `openspec-cascade.wt/agent-tasks-lint` (rama `agent/tasks-lint`, desde `main` 85813a5).

## Pasos

| # | Paso | Resultado | Fricción |
|---|---|---|---|
| 0 | `forja wt new tasks-lint --agent claude` | OK, sin `init-project` | No funciona desde el sandbox de Claude; lo lanza el usuario. |
| 1 | `/cascade-spec-brainstorm tasks-lint "<idea>"` | 1.er intento `Unknown command`; plugin instalado con `--scope local` en el worktree | El plugin `cascade` no estaba instalado y nada del flujo lo instala ni lo detecta (ni forja ni `doctor`). `bin/install.mjs` mezcla los comandos de 0b con hooks SDD y el workflow `cascade-looper` de v2, instalados a nivel de usuario. El plugin queda copiado en caché: editar comandos en el repo exige reinstalar. Candidato para la pieza 5 (`setup`/`doctor`). Además falta el CLI de OpenSpec (`openspec`), del que depende todo el ciclo, y forja no lo declara. `install.mjs --dry-run` se queda esperando un `[Y/n]` aunque sea un ensayo. |
| 2 | `/opsx:propose tasks-lint` | Se ejecutó como `/cascade:openspec-propose`; el change ya existía y el paso de creación se omitió, como documenta el traspaso. Salieron proposal, spec, design y tasks; `openspec validate --strict` pasó tras partir dos requisitos largos | El traspaso de `cascade-spec-brainstorm` manda a `/opsx:propose`, que aquí no existe. Los nombres reales son `/cascade:openspec-propose`, `/cascade:openspec-apply-change` y `/cascade:openspec-archive-change`. El usuario lo notó al pedir `/opsx:apply` (el asistente también lo nombró mal). La pieza 1 cubre las dos formas `:` y `-` de los comandos de OpenSpec, pero no que estén instalados. |
| 3 | `/cascade-spec-review tasks-lint` | Etapas 5 a 9 en modo interactivo. 1 bloqueante y unos 30 mayores, que el triaje redujo a 6 decisiones. Cambió el diseño: se quitó la marca de exención, el chequeo pasó al `preflight` (cubre v1 y v2) y se corrigió `parseTasks` para CRLF y BOM | En la Etapa 5, `egm-synthesizer` terminó antes que sus revisores, no escribió informe y pidió repetir; se despachó a los revisores desde el hilo principal, que EGM permite, y se hizo igual en las demás etapas. Cada etapa deja un informe en el change (6 ficheros) y `review.md` se consolida a mano y se vuelve a sellar `open` tras cada una. Los informes describen el texto previo al triaje. Cinco puntos de control interactivos sin decisión real salvo el triaje. |
| 4 | `spec-gate check --stage review --changes tasks-lint` | `ok` tras sellar; luego pasó a `stale` | Editar `design.md` para documentar divergencias de la deriva dejó la revisión `stale`, aunque eran ediciones de documentación de lo ya implementado. El sello no distingue ediciones sustantivas de las que solo sincronizan texto, y volver a sellar exige una decisión del usuario. |
| 5 | Noche corta de cascade | **No ejecutada.** El `apply` fue interactivo con `/cascade:openspec-apply-change` | Sigue pendiente de validar `forja wt night` de punta a punta. La clave de firma de agente de forja no está registrada en GitHub (ver fricción transversal), así que una noche real dejaría commits que GitHub no verifica. |
| 6 | `/cascade-spec-drift tasks-lint` | Se hizo en el hilo, sin revisores (el procedimiento de EGM es de un solo agente): 6 divergencias menores en `design.md` y ninguna en el spec. 5 se resolvieron editando el diseño y 1 en el código | El hook SDD bloqueó borrar una constante sin uso en `src/`, porque las 12 tareas del change estaban marcadas y no había un change activo con tareas pendientes. La edición la hizo el usuario a mano. Un hook que no deja corregir una divergencia de deriva sin reabrir tareas choca con el propio paso de deriva. |
| 7 | `spec-gate check --stage drift` y archive | `drift` en `ok`; el archivado creó el primer spec principal del repo (`openspec/specs/tasks-lint/spec.md`, que estaba vacío) y movió el change a `openspec/changes/archive/2026-11-16-tasks-lint/` | Se archivó antes del merge, así que hizo falta un commit más en la misma rama (PR #52). Tras archivar, `spec-gate check --changes tasks-lint` falla porque la carpeta ya no existe; es esperado, pero nadie lo avisa. |

## Fricción transversal

- El hook rtk reescribe los comandos de Bash y el modo auto se niega a revisarlos: git desde Claude o sus subagentes falla, y el usuario tiene que lanzar cada commit y push con `!`.

- `forja plan`/`drift` no ven cambios en módulos con carpetas como destino: `chezmoi diff <carpeta>` no es recursivo (chezmoi 2.74.1). `apply` sí funciona.
- Las skills de OpenSpec del plugin las generó la 1.14.3; mise instala la 2.0.0 (fijada, decisión del usuario), así que esta validación prueba también la 2.x. Telemetría desactivada con `OPENSPEC_TELEMETRY=0` en el `[env]` de mise.

- El plugin `cascade` trae el hook SDD de v2 (`PreToolUse` en Edit/Write) que bloquea editar código de producción sin un change activo. Con `install.mjs` (`--scope user`) se aplicaría a todos los proyectos. Instalado con `--scope local` solo en el worktree; workflow `cascade-looper` y `bun link` omitidos.

- Los tests que crean repositorios git (`createTempGitRepo`) no pueden ejecutarse en el sandbox de Claude: la configuración global firma los commits con una clave de `~/.ssh` que el sandbox oculta, así que 15 tests de fachada y 2 de CLI fallan con "Couldn't load public key". El usuario tiene que ejecutar `bun test` fuera del sandbox y pasar la salida.
- Firma de commits de agente (causa raíz y arreglo). El perfil de forja tenía una sola clave de agente, `[signing] agent_key = ~/.config/forja/agent-signing` (huella `jTRo78…`), y el `config.worktree` de este repo, que usa la identidad personal (`sastiam`), la heredaba. Esa clave no está en la cuenta `sastiam` (GitHub responde `key is already in use` al intentar añadirla, así que está en otra cuenta, con toda probabilidad la de trabajo), y la regla "Commits must have verified signatures" rechazó el push de los 3 commits. La clave propia de `sastiam` (`agent-signing-sastiam`, `BGcgQQKF…`) ya existía y estaba registrada en GitHub; faltaba solo `agent_key` en `[git.identities.personal]`. Arreglo: esa línea y `forja git identity apply`; `forja git identity check` y `forja doctor` pasan y un commit de prueba sale firmado con `BGcgQQKF…`. Mientras tanto hubo que volver a firmar los 3 commits con la clave personal (`rebase --exec 'git commit --amend --no-edit -S'` con `-c user.signingkey=…`). Cambiar `user.signingkey` con `--worktree` no se mantuvo porque forja reaplica `config.worktree`. Ni `forja git identity check` ni `doctor` avisan de que la clave de agente no esté registrada en la cuenta de la identidad del repo; candidato para la pieza 5.
- El hook rtk obligó a repetir cada llamada de Bash una vez (el modo auto rechaza la primera porque el hook la modifica). En este ciclo fueron decenas de llamadas duplicadas.
- El hook de calidad avisa de números mágicos en tests (por ejemplo `repeat(3)`); útil, pero obligó a extraer constantes con nombre incluso en fixtures.
- `forja wt` no se puede lanzar desde el sandbox y `git commit`/`push` firmados tampoco; todos los commits, el push y la apertura del PR los hizo el usuario con `!`.

## Notas para la pieza 2

Material para el contrato de autonomía (candidatos, no decisiones). Decisiones humanas que hubo en este ciclo:

- Confirmar el andamiaje del change, el gate de preparación del brainstorm y las dos preguntas de alcance del brief (~5 turnos).
- Elegir el modo de revisión y pasar 5 puntos de control, uno por etapa. Solo el triaje final cambió algo; los demás se aceptaron sin edición.
- Triaje de la revisión: 6 decisiones de diseño. Es donde el humano aportó valor: revirtió la marca de exención, que él mismo había elegido en el brainstorm.
- Decidir la sincronización de specs al archivar (una pregunta con una respuesta obvia).
- Todo lo que toca git hacia fuera (commit firmado, push, PR) fue manual por la restricción de firma, no por diseño.

Candidatos: avanzar solos por los puntos de control de etapa y detenerse en el triaje y en las acciones hacia fuera; no pedir confirmación cuando la opción recomendada es única; que el sello distinga ediciones de documentación; que el hook SDD permita correcciones de deriva sobre un change cuyas tareas están todas marcadas.

Hueco para la pieza 5: ni forja ni `doctor` detectan que el CLI de OpenSpec, los comandos `/opsx:*` o el plugin `cascade` estén instalados, y los textos los nombran como si lo estuvieran.
