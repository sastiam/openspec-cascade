# DISPATCH — Explorer 2: LLM Provider Abstraction Specialist

## Identity
- Role: LLM Provider Abstraction Specialist
- TypeName: teamwork_preview_explorer
- Working Directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2
- Parent Orchestrator: teamwork_preview_orchestrator_1 (Conv ID: 6d20d99d-2183-4d1a-ad2e-afc1d559cde6)

## Mandatory Inputs
- Original Request: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md
- Reference architectures: Claude (Anthropic API / Messages / Tool Use / Claude Code / MCP), Antigravity (Google Gemini API / Antigravity CLI / protocol), OpenCode (Local / Open-source models, Ollama, vLLM, LiteLLM, Agent Communication Protocols).
- Target deliverable directory: /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper

## Objectives
1. Read `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md` thoroughly.
2. Design the Provider Abstraction Layer (PAL) interface contracts supporting:
   - Claude (Anthropic API / Claude Code agent runtime / Anthropic SDK / MCP integration)
   - Antigravity (Google / Gemini 1.5 Pro/Flash, Antigravity CLI / agent runner)
   - OpenCode (Ollama / vLLM / OpenAI-compatible / LiteLLM / ACP)
3. Detail:
   - Unified message schema (roles, text, tool calls, tool results, thoughts)
   - Unified tool definition & execution interface (MCP compatibility, native tools)
   - Streaming, error handling, rate limiting, and context window management across providers
   - Provider capability negotiation (supports_tools, supports_vision, context_length, reasoning_effort)
4. Deliver a comprehensive analysis and report in `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2/handoff.md`.


## 2026-10-24T14:20:17Z
[Message] timestamp=2026-10-24T14:20:17Z sender=6d20d99d-2183-4d1a-ad2e-afc1d559cde6 priority=MESSAGE_PRIORITY_HIGH
content=You are an Explorer subagent (LLM Provider Abstraction Specialist).
Your working directory is /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2.
Read your dispatch instructions in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2/DISPATCH.md and the user request in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md.

Research and design the Provider Abstraction Layer (PAL) contracts supporting Claude, Antigravity, and OpenCode. Specify unified message schemas, tool definitions, execution interfaces, streaming, error handling, rate limiting, and capability negotiation.

Deliver a comprehensive specification report to /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2/handoff.md. When complete, send a message back to the orchestrator with the summary of findings and the path to your handoff report.
