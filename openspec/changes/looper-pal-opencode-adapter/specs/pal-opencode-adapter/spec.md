# Spec Delta: Adaptador OpenCode / Modelos Locales, Puente MCP y Parser ReAct

## Purpose

Soporte para OpenCode y modelos locales (DeepSeek, Llama) con auto-reparación JSON y puente MCP.

## ADDED Requirements

### Requirement: Local Models and ReAct Fallback
The adapter SHALL extract tool calls from markdown or repair corrupted JSON arguments.

#### Scenario: Model outputs raw markdown code block for tool call
- **WHEN** Model outputs raw markdown code block for tool call
- **THEN** The ReAct parser extracts command parameters reliably
