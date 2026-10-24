# DISPATCH — Worker M1.1: Technical Architecture Specification Author

## Identity
- Role: Technical Architecture Specification Author
- TypeName: teamwork_preview_worker
- Working Directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_1
- Parent Orchestrator: teamwork_preview_orchestrator_1 (Conv ID: 6d20d99d-2183-4d1a-ad2e-afc1d559cde6)

## Mandatory Inputs
- Original Request: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md
- Project Scope: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/teamwork_preview_orchestrator_1/PROJECT.md
- Architectural Research (Explorer 1): /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_1/handoff.md
- PAL Research (Explorer 2): /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2/handoff.md
- GitHub Environment Research (Explorer 3): /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3/handoff.md

## Exclusive Write Ownership
- `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md`
- `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_1/*`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Objective & Task Instructions
Author the comprehensive Master Technical Specification for the Provider-Agnostic Multi-Agent Looper ("Agnostic Looper") inspired by Antigravity Teamwork.

The specification must be written to:
`/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md`

It must be exhaustive, rigorous, and completely specify:
1. **Executive Summary & System Vision**: Core objectives, design philosophy, Antigravity Teamwork inspiration, separation of cognitive roles.
2. **Looper Engine Architecture & Lifecycle**:
   - Detailed Finite State Machine (FSM) states and valid/invalid transitions
   - Autonomous task routing & execution cycle
   - 6-tier Cognitive Role Specialization Matrix (Sentinel, Orchestrator, Explorer, Worker, Reviewer, Adversarial Challenger, Forensic Auditor)
   - 6-rung Escalation Ladder (local retry -> Challenger diagnostic -> Explorer root-cause analysis -> clean Worker replacement -> task re-decomposition -> Sentinel human escalation)
3. **Objective 4-Tier Verification Gates**:
   - Gate 0: Automated Oracle / QA Checks (bun test, tsc, lint, shell assertions)
   - Gate 1: Semantic Code Review (spec fidelity, zero regression, clean code)
   - Gate 2: Adversarial Challenger (edge cases, fuzzing, breaking stress tests)
   - Gate 3: Forensic Auditor (uncompromising binary veto, repo invariants)
4. **Provider Abstraction Layer (PAL) Interface Contracts**:
   - Hexagonal Ports & Adapters architecture (Direct API Clients + CLI Subprocess Runners)
   - Canonical `PalMessage` & `PalContentBlock` schemas (text, thought, tool_call, tool_result, image)
   - Bi-directional Turn Normalizers resolving provider invariants:
     * Anthropic Messages API (alternating user/assistant turns, top-level system, tool_use/tool_result pairing)
     * Google Gemini GenAI API (contents with user/model roles, system_instruction, function_call/function_response parts)
     * OpenCode / OpenAI-compatible / LiteLLM (system/user/assistant/tool roles, tool_calls, JSON repair)
   - Extended Thinking & Reasoning Contracts (`PalThoughtContent`, cryptographic signatures, redaction)
   - Unified Tool Calling & MCP (Model Context Protocol) Bridge, including ReAct fallback for local models
   - Dynamic Capability Negotiation (`PalCapabilityMatrix`) & Leaky-Bucket Rate Limiter with reset-time detection
5. **State Persistence, Resilience & Fault Tolerance**:
   - File-based persistence in `.agents/teamwork/` (`BRIEFING.md`, `progress.md`, `DISPATCH.md`, `handoff.md`)
   - Working tree isolation, Git baseline capture & atomic `RollbackStateBuffer`
   - 16-Spawn Orchestrator Succession pattern
   - Idempotent crash recovery from disk
6. **Engineering Work Stream Decomposition Matrix**:
   - Formal breakdown into 4 streams: Core Engine, Provider Abstraction Layer, Verification Harness, and CLI/Interface & Integrations.

When finished:
1. Verify the deliverable exists and is fully populated.
2. Record `handoff.md` in your directory.
3. Send a message to the orchestrator with the summary of completed work and the path to `SPECIFICATION.md`.


## 2026-10-24T14:28:29Z
You are Worker M1.1 (Technical Architecture Specification Author).
Working directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_1.
Read your dispatch instructions in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_1/DISPATCH.md and the original user request in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md.
Also read the survey handoffs from Explorer 1 (/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_1/handoff.md), Explorer 2 (/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_2/handoff.md), and Explorer 3 (/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_3/handoff.md).

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task is to author the comprehensive Master Technical Specification for the Provider-Agnostic Multi-Agent Looper ("Agnostic Looper") inspired by Antigravity Teamwork.
Deliverable file: /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md.
Ensure the target directory exists and write the exhaustive, production-grade technical specification covering architecture, FSM lifecycle, role specialization matrix, 4-tier verification gates, PAL interface contracts (Claude, Antigravity, OpenCode), persistence & rollback, and work stream breakdown.

Verify the written document and write your handoff report to /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_1/handoff.md. Send a message to the orchestrator when finished.
