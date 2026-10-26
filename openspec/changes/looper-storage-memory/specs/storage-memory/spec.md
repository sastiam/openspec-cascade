# Spec Delta: Jerarquía de Memoria Persistente en FS y Watchdog de Heartbeats

## Purpose

Implementa el sistema de almacenamiento en disco en .agents/teamwork/ con aislamiento de estado, protección de secciones y watchdog de latidos.

## ADDED Requirements

### Requirement: State Scaffolding and Atomic Writes
The storage module SHALL initialize .agents/teamwork/ directory tree and commit state files atomically.

#### Scenario: Memory storage initializes
- **WHEN** Memory storage initializes
- **THEN** Scaffolding creates briefing, state, and sentinel directories

#### Scenario: State is serialized
- **WHEN** State is serialized
- **THEN** Writes occur atomically via temporary swap files

### Requirement: Heartbeat Watchdog
The watchdog SHALL track subagent heartbeats and trigger stale timeouts.

#### Scenario: An agent fails to touch heartbeat within SLA
- **WHEN** An agent fails to touch heartbeat within SLA
- **THEN** The watchdog triggers a STALENESS event
