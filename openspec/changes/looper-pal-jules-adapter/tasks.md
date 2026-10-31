# Tasks: Adaptador Google Jules (Jules Tools CLI)

## 1. Discovery

- [x] 1.1 Verificar empíricamente con la CLI real: formato de stdout de `remote new`/`list --session`, códigos de salida y semántica de `remote pull` (pendiente: login caducado y estados `Failed`/`Cancelled`)
- [ ] 1.2 Revisar https://jules.google/docs/cli/examples y la REST API para autenticación headless

## 2. Implementation & Verification

- [x] 2.1 Implementar `JulesAdapter` implementando `ProviderAdapter` en `src/pal/adapters/jules.ts`
- [x] 2.2 Implementar creación de sesión (`remote new`, incl. `--parallel`) y extracción del ID de sesión
- [x] 2.3 Implementar sondeo de estado con intervalo/timeout configurables y mapeo a eventos canónicos
- [x] 2.4 Implementar recuperación de resultados (`remote pull --session`)
- [x] 2.5 Manejo de errores tipados: CLI ausente, sin autenticación, timeout, sesión fallida
- [x] 2.6 Crear `test/pal/jules.test.ts` con subproceso simulado; verificar con `bun test test/pal/jules.test.ts`

## 3. Batch & hardening

- [x] 3.1 Tratar una sesión `AWAITING_INPUT` como terminada cuando `remote pull` devuelve un diff: se emite la transición a `completed`, se retira de los pendientes y el diff se reutiliza en `streamTurn`/`executeTurn` sin un segundo pull
- [x] 3.2 Mantener la política de awaiting-input para sesiones con pull vacío o fallido (fallo de pull = "no listo"); no se propagan errores de pull desde el sondeo
- [x] 3.3 Añadir `JulesAdapter.runBatch(tasks, { maxConcurrent })` con un resultado por tarea (`diff`, `empty`, `failed`, `timeout`, `needs_input`) y lotes de sesiones de tamaño `maxConcurrent` (por defecto 5, validado entre 1 y 5)
- [x] 3.4 Un fallo de una tarea (creación, sesión fallida, pull, awaiting-input o timeout) se registra solo en su resultado y no aborta las demás
- [x] 3.5 Compartir un único `remote list` por sondeo entre todas las sesiones de un lote
- [x] 3.6 Exportar `buildJulesPrompt({goal, files, verifyCommand, constraints})` con los archivos exactos, el comando de verificación y las restricciones "no modificar otros archivos" y "no abrir pull request"
- [x] 3.7 Pruebas unitarias con subproceso simulado y reloj falso para awaiting+diff, awaiting+vacío, política keep-waiting, lotes, resultados por tarea y `buildJulesPrompt` (`bun test test/pal/jules.test.ts`)
