# Spec Delta: Esquema Canónico de Mensajes y Normalizador Bidireccional

## Purpose

Define los tipos canónicos de mensajes, bloques de contenido y normalizador para desacoplar el motor de los proveedores de LLM.

## ADDED Requirements

### Requirement: Canonical Schema Normalization
The PAL layer SHALL translate provider-specific payloads to and from the canonical representation.

#### Scenario: Provider emits consecutive assistant or tool turns
- **WHEN** Provider emits consecutive assistant or tool turns
- **THEN** The normalizer applies turn-folding into unified turns

#### Scenario: Thinking blocks are present
- **WHEN** Thinking blocks are present
- **THEN** Cryptographic thought signatures and reasoning blocks are preserved
