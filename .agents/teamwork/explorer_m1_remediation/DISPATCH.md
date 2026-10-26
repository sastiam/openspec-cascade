# DISPATCH — Explorer M1.4: Remediation Architecture Planner

## Identity
- Role: Remediation Architecture Planner
- TypeName: teamwork_preview_explorer
- Working Directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_m1_remediation
- Parent Orchestrator: teamwork_preview_orchestrator_1 (Conv ID: 6d20d99d-2183-4d1a-ad2e-afc1d559cde6)

## Mandatory Inputs
- Original Request: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md
- Current Spec: /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md
- Reviewer M1.2 Handoff: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/reviewer_m1_2/handoff.md
- Challenger M1.1 Handoff: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/challenger_m1_1/handoff.md
- Challenger M1.2 Handoff: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/challenger_m1_2/handoff.md

## Objectives
Synthesize a comprehensive, unambiguous remediation plan for Worker M1.2 to resolve all findings from Gate 1:
1. **FSM & Escalation Fixes (Challenger M1.1)**:
   - Fix git clean command to protect `.agents/teamwork/` and `projects/` (`git clean -fd -e .agents/teamwork/ -e projects/`).
   - Fix Victory Audit failure livelock: transition `EVT_VICTORY_FAIL` to `STATE_ESCALATION` -> `BLOCKED` instead of `STATE_ROLLBACK_RECOVERY`.
   - Add missing state transitions: allow `STATE_GATE_0_AUTO -> STATE_GATE_3_AUDIT` for Fast-Track docs tasks.
   - Add `STATE_DISPATCH_EXPLORER` and `EVT_NEEDS_DIAGNOSIS`.
   - Fix escalation ladder ordering so Challenger/Explorer diagnostics occur before hard reset.
   - Add max attempt bound on Gate 2 (e.g. 3 attempts before escalation).
2. **PAL Contracts & Error Taxonomy (Reviewer M1.2)**:
   - Remove pre-emptive self-certification status in header (`Status: PROPOSED / UNDER REVIEW`).
   - Add full TypeScript definitions for `IPalProvider`, `PalSessionOptions`, `PalOutcome`, `PalStreamEvent`, `PalTokenUsage`, and `PalRateLimitInfo`.
   - Add standardized `PalErrorKind` enum and error taxonomy (`PAL_RATE_LIMITED`, `PAL_CONTEXT_OVERFLOW`, etc.).
   - Fix type safety in `PalTurnNormalizer` (replace `any` with strict types).
   - Add tool execution contracts: `PalToolExecutionContext`, `PalToolHandler`, `PalToolChoice`.
   - Formalize Token/Leaky Bucket formulas and exponential backoff parameters.
3. **Provider Invariants & Fallbacks (Challenger M1.2)**:
   - Add Turn-Folding Invariant (merge consecutive same-role messages for Anthropic).
   - Add Atomic Tool Batch Resolution (synthetic error generation for orphaned calls).
   - Wrap Gemini `function_response` payloads in JSON maps (`{ output: ... }`).
   - Add ReAct truncation watchdog and unclosed `<tool_call>` error handling.
   - Add jittered backoff to prevent thundering herd 429 storms.

Deliver the detailed remediation strategy and exact code/content blocks to:
`/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_m1_remediation/handoff.md`.
Send a message to the orchestrator when complete.

## 2026-10-24T14:41:41Z
You are Explorer M1.4 (Remediation Architecture Planner).
Working directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_m1_remediation.
Read your dispatch instructions in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_m1_remediation/DISPATCH.md and the user request in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md.
Also read the detailed reports from Reviewer M1.2 (/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/reviewer_m1_2/handoff.md), Challenger M1.1 (/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/challenger_m1_1/handoff.md), and Challenger M1.2 (/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/challenger_m1_2/handoff.md).

Formulate a comprehensive, concrete remediation strategy containing exact TypeScript definitions, state transition updates, git clean exclusions, and invariant mitigations to fix all findings in projects/agnostic_looper/SPECIFICATION.md.
Write your handoff report to /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_m1_remediation/handoff.md and send a message when complete.
