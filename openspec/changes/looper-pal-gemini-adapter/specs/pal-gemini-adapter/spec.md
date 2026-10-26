# Spec Delta: Adaptador Google Gemini y Antigravity con Streaming NDJSON

## Purpose

Conecta el looper con Google Gemini y la CLI Antigravity con soporte para 2M de contexto y streaming NDJSON.

## ADDED Requirements

### Requirement: Gemini / Antigravity Execution
The adapter SHALL parse streaming tokens and tool calls from Gemini and Antigravity.

#### Scenario: Tool parameters arrive as protobuf structs
- **WHEN** Tool parameters arrive as protobuf structs
- **THEN** The adapter serializes them into standard JSON structures
