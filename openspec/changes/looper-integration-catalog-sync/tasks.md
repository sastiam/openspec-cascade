# Tasks: Generador de Catálogo Local de Tareas y Sincronizador Bidireccional

## 1. Implementation & Verification

- [x] 1.1 Implement catalog generator in `src/integration/catalog_generator.ts` producing `tasks_catalog.json` and `.md`
- [x] 1.2 Implement schema validator asserting 100% presence of mandatory task sections
- [x] 1.3 Implement drift detection alerting when remote GitHub items diverge from local state
- [x] 1.4 Create unit test suite `test/integration/catalog.test.ts`; verify with `bun test test/integration/catalog.test.ts`
