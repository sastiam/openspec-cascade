# Spec Delta: Enrutador Autónomo, Escalera de 6 Peldaños y Sucesión

## Purpose

Gestiona el enrutamiento dinámico, resolución de fallos escalonados y relevo de orquestadores tras 16 spawns.

## ADDED Requirements

### Requirement: Context Succession and Escalation
The router SHALL rotate orchestrators when spawn quota approaches the 16-spawn threshold.

#### Scenario: Orchestrator reaches spawn limit
- **WHEN** Orchestrator reaches spawn limit
- **THEN** A succession snapshot is preserved and the next orchestrator assumes control
