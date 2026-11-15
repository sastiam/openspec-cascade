# Spec: Import Hygiene

## ADDED Requirements

### Requirement: Acyclic Module Graph
The system MUST have zero runtime (value) import cycles among production modules and MUST NOT have type-level cycles except through an explicit, documented allowlist of type-only edges from a contract module to an implementation class it names.

#### Scenario: Static cycle scan
- **WHEN** `test/architecture/import_cycles.test.ts` builds the import graph of root `*.ts` and `src/**/*.ts`
- **THEN** Tarjan's algorithm finds no strongly connected component larger than one module over value edges, nor over type edges once the allowlisted type-only edges are removed

#### Scenario: Allowlist stays honest
- **WHEN** an allowlisted edge no longer exists or is no longer type-only
- **THEN** the architecture test fails

### Requirement: Backward-Compatible Re-Exports
The system MUST keep every previously exported symbol importable from its original module after extraction.

#### Scenario: Legacy import paths resolve
- **WHEN** existing tests import gate, catalog and engine symbols from their original modules
- **THEN** they compile and pass unchanged
