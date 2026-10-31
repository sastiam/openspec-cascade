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
