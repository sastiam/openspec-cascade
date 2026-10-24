# Spec Delta: Gate 0: Ejecutor de QA Mecánico Automatizado y Formateador de Trazas

## Purpose

Oráculo mecánico de primera línea que ejecuta pruebas, comprobación de tipos y linters con feedback estructurado.

## ADDED Requirements

### Requirement: Gate 0 Oracle Verification
Gate 0 SHALL execute deterministic checks and reject any regression.

#### Scenario: A unit test fails or tsc reports a type mismatch
- **WHEN** A unit test fails or tsc reports a type mismatch
- **THEN** Gate 0 returns a structured failure with stdout/stderr traces
