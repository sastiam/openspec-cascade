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
| 5 | Noche corta de cascade | **No ejecutada en este ciclo.** El `apply` fue interactivo con `/cascade:openspec-apply-change`. Se validó después con `spec-gate-archived-hint` (ver la segunda pasada, abajo) | Sigue pendiente de validar `forja wt night` de punta a punta. La clave de firma de agente de forja no está registrada en GitHub (ver fricción transversal), así que una noche real dejaría commits que GitHub no verifica. |
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

## Segunda pasada: ejecución desatendida con `spec-gate-archived-hint`

Objetivo: el paso 5 que faltaba, `forja wt night` de punta a punta con un change real pequeño (que `spec-gate check` distinga un change archivado o sin carpeta de un informe que falta). Resultado: PR #57, mergeada.

| # | Paso | Resultado | Fricción |
|---|---|---|---|
| 1 | Ensayo de `forja wt night` | Todas las comprobaciones pasan salvo la del agente dentro del sandbox: `You've hit your 5-hour limit` | El límite de uso de la suscripción solo se descubre al lanzar. Una ejecución larga podría toparse con él a mitad de camino. |
| 2 | Primer lanzamiento | `STOPPED: Working tree is dirty` por `?? .env.worktree` | `forja wt` escribe `.env.worktree` en cada worktree y este repo no lo ignoraba. `forja wt night` no aceptaba `--allow-dirty`, y con `-- --allow-dirty` lo descartaba en silencio (posicional ignorado). Arreglado en forja #37: el worktree añade `.env.worktree` al `info/exclude` del repo y `wt night` rechaza argumentos que no usa. |
| 3 | Segundo lanzamiento | `STOPPED: …/spec-gate-archived-hint/tasks.md not found` | El worktree salía de `origin/main` y el change solo estaba en la rama de trabajo. El preflight de forja buscaba el change en el checkout, no en la base del worktree. Se resolvió moviendo la rama de la noche encima de la rama de trabajo. Arreglado en forja #37: `--base <rama>` y el preflight busca el change commiteado en la base. El spec-gate del preflight sigue corriendo sobre el checkout. |
| 4 | Ejecución | 2 tareas, 2 commits firmados con la clave de agente, unos 3 minutos y 0,60 $ (motor `claude`, modelo Sonnet) | Ver los hallazgos del arnés, abajo. |
| 5 | Revisión de la mañana | El código cumple el diseño. `bun test` fuera del sandbox: 2103 pasan, 0 fallan | El asunto del segundo commit se corrigió a mano (`--amend`). |
| 6 | Integración, deriva y archivo | Fast-forward a la rama de trabajo; `/cascade-spec-drift`: 1 divergencia (separador de rutas en Windows), aceptada; archivado con spec principal nuevo `openspec/specs/spec-gate/spec.md` | Tras archivar, `spec-gate check` sobre el propio change ya dice `archived (openspec/changes/archive/2026-11-16-spec-gate-archived-hint)`: el change se validó a sí mismo. |

### Hallazgos del arnés (material para la pieza 2)

1. **Comandos de la prosa como verificación.** El arnés exige código 0 a todos los `bun …` que aparecen en la tarea, no solo a los de la línea `Verify:`. Una tarea de "tests en rojo" nunca se acepta, y `lint-tasks` no lo detecta.
2. **`fast-track` se salta un `Verify:` que falló.** La tarea 2.1 pedía `bun test` con cero fallos; el agente informó 2099 pasan y 4 fallan dentro del sandbox, y el arnés aceptó la tarea con `fast-track: docs-only change, skipping bun test`. Aquí no hizo daño, pero el `Verify:` declarado no se cumplió. Es incoherente con el hallazgo 1.
3. **Tests que solo fallan en el sandbox.** Esos 4 fallos no se reproducen fuera. Por el intento del agente (`GIT_CONFIG_* commit.gpgsign=false`), apunta a tests que hacen commits firmados, como en la primera pasada.
4. **El log recorta los mensajes del agente.** El jsonl guarda solo el principio de cada mensaje, así que no se puede saber qué 4 tests fallaron.
5. **Asunto del commit equivocado.** El commit de la tarea de documentación salió como `feat(spec-gate): report archived and missing change folders in check and document the new reasons in`: tipo `feat` en un cambio de docs, texto de la tarea anterior y cortado a mitad de frase.
6. **Sincronización de diagramas sin comprobar herramientas.** Al terminar el change, `graphify update .` y los diagramas de Archify salen con 127 (no instalados) y el arnés lo marca como ❌. Debería saltar el paso si faltan. Además, `graphify-out/` versionaba su caché y rutas de la máquina; arreglado en #58 (caché fuera de git y copiada a cada worktree con `.worktreeinclude`).

### Fricción transversal (segunda pasada)

- El hook rtk siguió reescribiendo `git`, `ls`, `find` y `grep` en modo auto pese a forja #35. Se esquivó con `/usr/bin/git` y rutas absolutas. Hay que revisarlo antes de la próxima ejecución desatendida.
- Commits desde Claude en este repo: funcionan con la clave de agente de `sastiam` y el committer noreply (`-c user.signingkey=~/.config/forja/agent-signing-sastiam`). GitHub verificó los 6 commits de la PR #57. El push sigue siendo manual (403 con las credenciales de trabajo).

### Decisiones humanas en la segunda pasada

- Reintentar tras cada `STOPPED` (dos veces, ambas por fallos de montaje de forja, ya arreglados).
- Aceptar la divergencia de deriva y sincronizar el spec al archivar: dos preguntas con respuesta recomendada.
- Ninguna decisión durante la ejecución: el change era pequeño y no hubo `BLOCKED:`. Falta una pasada con un change que obligue a decidir para probar el contrato de autonomía.
