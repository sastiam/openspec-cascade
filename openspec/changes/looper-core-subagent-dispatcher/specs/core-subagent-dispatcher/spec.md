# Spec Delta: Despachador de Roles Cognitivos y Gestor de Sandboxes

## Purpose

Asigna roles cognitivos especializados (Explorer, Worker, Challenger, Auditor) con sandboxes de ejecución aislados.

## ADDED Requirements

### Requirement: Subagent Sandboxing
Each spawned subagent SHALL operate in an isolated branch or shared worktree.

#### Scenario: A worker completes execution
- **WHEN** A worker completes execution
- **THEN** A structured handoff report is generated and validated
