# Spec Delta: Servicio de Integración con GitHub Project #4 vía GraphQL y gh CLI

## Purpose

Cliente de comunicación directa con GitHub Projects V2 para actualizar estados, prioridades y consultar tareas.

## ADDED Requirements

### Requirement: GitHub Project V2 Synchronization
The service SHALL query and mutate Project #4 items using ambient credentials.

#### Scenario: A task passes Gate 3 forensic audit
- **WHEN** A task passes Gate 3 forensic audit
- **THEN** The service updates the corresponding item Status to Done
