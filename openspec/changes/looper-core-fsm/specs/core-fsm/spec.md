# Spec Delta: Máquina de Estados Finita (FSM) del Motor Central y Livelock Prevention

## Purpose

Implementa la FSM de 16 estados del looper con transiciones dirigidas por eventos y prevención de bloqueos.

## ADDED Requirements

### Requirement: Deterministic FSM Execution
The engine SHALL transition only across declared valid state edges.

#### Scenario: An illegal event is dispatched
- **WHEN** An illegal event is dispatched
- **THEN** The FSM rejects the transition and raises an InvalidStateTransition error

#### Scenario: Victory audit fails repeatedly
- **WHEN** Victory audit fails repeatedly
- **THEN** Livelock prevention trips the circuit breaker to ESCALATED
