# Spec Delta: Adaptador de Proveedor Anthropic Claude con Extended Thinking

## Purpose

Integra Claude Sonnet 3.7 con prompt caching, bloque de pensamiento y control de presupuestos.

## ADDED Requirements

### Requirement: Claude Provider Interoperability
The adapter SHALL execute prompts against Anthropic API returning canonical turns.

#### Scenario: Extended thinking is configured
- **WHEN** Extended thinking is configured
- **THEN** Thinking tokens are accumulated separately from completion tokens
