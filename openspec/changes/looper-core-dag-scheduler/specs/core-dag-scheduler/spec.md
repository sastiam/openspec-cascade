# Spec Delta: Planificador de Tareas DAG y Resolutor Topológico de Dependencias

## Purpose

Resuelve el orden topológico de tareas acíclicas garantizando ejecución sin deadlocks y paralelismo seguro.

## ADDED Requirements

### Requirement: Topological Dependency Sorting
The scheduler SHALL sort task definitions ensuring prerequisites precede dependents.

#### Scenario: A cycle is detected in task definitions
- **WHEN** A cycle is detected in task definitions
- **THEN** The scheduler throws a CircularDependencyError identifying the cycle

#### Scenario: Multiple tasks share the same dependency level
- **WHEN** Multiple tasks share the same dependency level
- **THEN** The scheduler batches them for concurrent execution
