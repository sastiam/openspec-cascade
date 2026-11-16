# Mapa de cascade como arnés-puzzle

Estado: borrador para aprobación (2026-11-16). Es un mapa, no un diseño de implementación: cada pieza tendrá su propio diseño, rama y PR.

## Intención y porqué

Velocidad sin deuda. El usuario planifica con IA y ejecuta de noche con cascade; los fallos recurrentes son: se olvida la configuración de producción, el código sale enredado y con comentarios o números mágicos, Greptile puntúa mal, y las tareas dictan líneas de código. Cascade debe crecer despacio hasta ser un arnés **complementario**: la inteligencia va en la planificación, la ejecución es de baja fricción, y por la mañana llega un resumen en lenguaje llano.

Contexto de uso (solo como ejemplo): equipo de platform AI con paquetes internos y un agente LangGraph/AWS; proyecto personal con un árbol de nodos.

## Reglas del puzzle

1. OpenSpec es la única fuente de verdad. Cada pieza lee y escribe solo dentro de la carpeta del change.
2. Las piezas se comunican por ficheros y exit codes, nunca por imports.
3. Todo es opt-in: si una pieza no está, no hay gate y nada se rompe.
4. El código decide, los prompts opinan. Los gates (hash, sello, exit code) son TypeScript pequeño y testeable; el juicio vive en prompts de EGM y Greptile.
5. Crecer es añadir un hueco, no una rama dentro del loop.
6. Un humano triasa los hallazgos de review; nada de eso se aplica solo. Las decisiones del agente (`DECISION:`) sí se aplican, pero quedan registradas y se revisan en la PR.
7. No se toca el CLI de OpenSpec ni sus comandos generados (`openspec update` los sobrescribe). Las piezas propias los envuelven leyendo la skill instalada y aplicando sobrescrituras.
8. Una preferencia solo es fiable de noche si algo ejecutable la comprueba.

## Ciclo

```
worktree ─► /cascade:explore ─► propose ─► spec review ─► [cascade] ─► code review ─► drift ─► archive
(forja)     OpenSpec+EGM+inv.   OpenSpec      EGM         ejecuta      Greptile       EGM     OpenSpec
```

Un worktree = un ticket de Linear = un change = una rama = una PR. El ID del ticket va en el nombre del change.

Nombres de comandos de OpenSpec: `/opsx:explore`, `/opsx:propose`… en Claude Code; `/opsx-explore`, `/opsx-propose`… en otros agentes. Los textos propios deben nombrar ambas formas.

## Piezas, estado y orden

| # | Pieza | Estado hoy | Rama / PR |
|---|---|---|---|
| 0 | Fast-track de docs en `runTask` | Hecho | PR #47 |
| 0b | EGM: `spec-gate` y comandos `cascade-spec-{brainstorm,review,drift}` | En main, sin probar con un ticket real | `main` |
| 1 | Nombres de comandos (`:` y `-`) en los textos propios | En curso | `feat/command-names` |
| 2 | Contrato de autonomía | Por diseñar | — |
| 3 | `/cascade:explore` | Por diseñar | — |
| 4 | `manual.md` y lint de `tasks.md` | Lint de bloques de código y `Verify:` hecho; verbos manuales y `manual.md` por diseñar | `agent/tasks-lint` |
| 5 | `setup`, manifiesto y `doctor` | Por diseñar | — |
| 6 | `status`, avisos y frenos | Por diseñar | — |
| 7 | Umbral de Greptile como puerta | Por diseñar | — |

Orden propuesto: 1, validación de 0b, 2, 4, 3, 5, 6, 7.

- La 1 se hace en `feat/command-names`, desde main (la 0b ya está fusionada). Cubre solo los comandos de OpenSpec; los nombres de los comandos propios se deciden en la 3.
- Antes de diseñar la 2 se valida la 0b con un ticket real pequeño: la 2 toca `runTask`, donde vive el gate de EGM, y la pasada real da datos de qué bloqueos aparecen.
- La 2 es la que más acerca a "toda la noche sin intervención".
- La 4 sube por delante de la 3: el lint de `tasks.md` es pequeño, ejecutable y ataca directamente que las tareas dicten líneas de código.

## Decisiones tomadas

### 2. Contrato de autonomía

- `BLOCKED:` deja de ser fatal. Hoy `runTask` lanza `Fatal` y para todo, sin rollback. Pasa a: guardar el trabajo parcial como parche en `openspec/changes/<change>/parked/<tarea>.patch`, hacer rollback de la tarea, aparcarla con su pregunta y seguir. El parche vive en el change para que viaje con la PR y respete la regla 1.
- Dependientes: si la tarea declara `Depends: 1.2, 2.1`, se usa. Si no, rige la **barrera por sección** (una tarea aparcada aparca las siguientes de su sección). Las demás secciones continúan.
- Convención `DECISION: <qué> — <por qué>` al final de la respuesta del agente, igual que ya se lee `COMMIT_SUBJECT:` y `BLOCKED:`.
- El agente decide solo únicamente si es **reversible y de bajo impacto** (nombres, estructura interna, valores por defecto). Siempre aparca si toca secretos, IAM, migraciones o datos destructivos, API pública o configuración de producción.
- Por la regla 8, ese límite lo comprueba código, no el prompt: una lista de rutas y patrones sensibles (por ejemplo `migrations/`, políticas IAM, `.env*`, `infra/`, `cdk.json`, la API pública declarada). Si el diff de la tarea toca alguno, la tarea se aparca sin consultar al agente. El prompt opina; el código decide.
- Resumen final en lenguaje llano con tres bloques: hecho, decidido por el agente (con porqué) y aparcado (con su pregunta y el parche).
- Descartado: portar el DAG de v2 (va contra la poda de v2).

### 3. `/cascade:explore`

- Se comporta como el explore de OpenSpec: **lee la skill instalada y la sigue**, con una pregunta enfocada cada vez cuando hay huecos.
- Sobrescrituras: escribe `brief.md` en el change (el explore de OpenSpec guarda las decisiones solo en la conversación); lanza los goldfish de EGM solo cuando el usuario confirma que la hipótesis está lista; carga las fuentes de investigación y las skills de patrones de diseño que el caso pida; aplica las reglas del proyecto (Well-Architected, arquitectura limpia si el repo lo amerita, sin números mágicos).
- Entrada: un prompt o el texto de un ticket de Linear pegado. Leer de Linear queda para más adelante.
- Salida: `brief.md` y la indicación del siguiente paso (propose). Se reutiliza el truco ya documentado de saltarse el paso de creación del change.
- Primera versión sin `setup`: las fuentes se indican en el prompt.

### 4. Tareas manuales

- Motivo: `openspec archive` se bloquea o avisa con tareas incompletas (`archive_tasks_incomplete`), y cascade solo reconoce tres frases como tareas humanas.
- `tasks.md` contiene **solo lo que un agente puede hacer y verificar**: resultado esperado y `Verify:`, nunca líneas de código.
- Lo operativo (desplegar, aprobar, ajustes manuales) va a `manual.md` dentro del change, sin casillas que cuenten para OpenSpec, cada paso con un `Check:` de solo lectura.
- Un comando pide al agente que ejecute esos checks y deje evidencia. **Verifica, no ejecuta el despliegue.**
- Lint de `tasks.md`: bloques de código y tareas sin `Verify:` (hecho en el change `tasks-lint`, subcomando `lint-tasks`). Verbos manuales con casilla: aplazado hasta definir `manual.md`.

### 5. `setup`

- Tres capas: máquina (forja instala y declara), proyecto (manifiesto de cascade), uso (`explore` lo consulta).
- `setup` descubre y registra, **no instala**. Greptile y engram aún no están en forja.
- Cada entrada del manifiesto: nombre, tipo (mcp, skill, cli), alcance (global o proyecto), cuándo usarla, obligatoria u opcional y un check de disponibilidad. Para MCP internos, `setup` pregunta una vez cuándo deben consultarse.
- `doctor` (ya existe) se extiende para verificar el manifiesto. Sin secretos en el manifiesto: solo nombres y variables de entorno. Todo opcional.

### 6. Estado, avisos y frenos

- `nextStep(change)`: función pura que deriva la etapa de los ficheros y los sellos. La expone `openspec-cascade status <change>`.
- Avisos blandos mediante un hook de sesión; frenos duros solo al lanzar la noche sin review vigente y al archivar sin drift.
- Qué etapas son obligatorias es una política por proyecto o por change. Por defecto: review antes de la noche y drift antes de archivar.
- No se ejecuta EGM automáticamente ni se crea un comando que lo orqueste todo. A lo sumo `/cascade-next <change>`, una tabla estado → comando.

### 7. Greptile

La integración ya existe (milestone M3: cliente, shadow worktree, caché, `cascade review --base`). Falta un umbral de puntuación como puerta y un sello `--stage code-review`.

## Non-goals y anti-goals

- Goldfish dentro del loop nocturno, o como Gate 1 de v2.
- Una segunda fuente de verdad junto a `openspec/` (por ejemplo `docs/designs/`).
- Aplicar hallazgos sin triaje humano.
- Que `setup` instale software o guarde secretos.
- Un comando que orqueste todo con lógica propia de cada paso.

## Preguntas abiertas

- Dónde vive el manifiesto de `setup` y qué formato usa (`.cascade/` es espacio de trabajo y no se commitea).
- Dónde se guarda el resumen de la mañana: solo en pantalla y log, o también en el change.
- Si `openspec/config.yaml` admite reglas por artefacto que guíen al `propose`; hay que comprobarlo antes de depender de ello. Se resuelve mirando el schema antes de empezar la 4.
- Si el umbral de Greptile es global o por proyecto.

## Convenciones

Una rama y una PR por pieza; nunca `main`. Conventional Commits con scope. El push a `sastiam/*` lo hace el usuario. Cada pieza empieza con su diseño corto y se implementa con TDD.
