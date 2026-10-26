# DISPATCH — Worker M1.2: Specification Remediation Specialist

## Identity
- Role: Specification Remediation Specialist
- TypeName: teamwork_preview_worker
- Working Directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_2
- Parent Orchestrator: teamwork_preview_orchestrator_1 (Conv ID: 6d20d99d-2183-4d1a-ad2e-afc1d559cde6)

## Mandatory Inputs
- Original Request: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md
- Project Scope: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/teamwork_preview_orchestrator_1/PROJECT.md
- Remediation Blueprints: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_m1_remediation/handoff.md
- Current Spec: /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md

## Exclusive Write Ownership
- `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md`
- `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_2/*`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Objective & Task Instructions
Amend and upgrade `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md` following the exact remediation blueprints provided by Explorer M1.4:
1. Update document status header to `PROPOSED SPECIFICATION (PENDING REVIEW GATES)`.
2. Update all rollback references to `git clean -fd -e .agents/teamwork/ -e projects/` to protect persistent agent memory.
3. Update the FSM lifecycle: 16 states, adding `STATE_DISPATCH_EXPLORER`, `STATE_EXECUTE_EXPLORER`, `STATE_ESCALATE_DIAGNOSTIC`, and `STATE_VICTORY_TRIAGE`. Fix Victory Audit livelock by unmarking culprit tasks. Add Fast-Track `STATE_GATE_0_AUTO -> STATE_GATE_3_AUDIT`. Add `MaxChallengeAttempts` guard on Gate 2. Fix Escalation Ladder ordering.
4. Add all missing TypeScript interfaces in Section 4: `IPalProvider`, `PalSessionOptions`, `PalOutcome`, `PalStreamEvent`, `PalTokenUsage`, `PalRateLimitInfo`, `PalFinishReason`, `PalErrorKind` taxonomy, `PalError` class, strict payload types (`ClaudeTurnPayload`, `GeminiTurnPayload`, `OpenAiTurnPayload`), tool execution types, and role enums.
5. Add provider invariant mitigations: Turn-Folding Invariant, Atomic Tool Batch Resolution, Gemini Struct Wrapping, ReAct Truncation Watchdog, and Token Bucket math with jittered backoff.

Verify the amended file thoroughly.
Deliver your handoff report to `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_2/handoff.md`.
Send a message to the orchestrator when complete.
## 2026-10-24T14:46:55Z
You are Worker M1.2 (Specification Remediation Specialist).
Working directory: /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_2.
Read your dispatch instructions in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_2/DISPATCH.md and the user request in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/ORIGINAL_REQUEST.md.
Read the turnkey remediation blueprints in /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_m1_remediation/handoff.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task is to amend and upgrade /home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md according to the 4 remediation blueprints:
1. Update document header and metadata.
2. Protect agent memory and project deliverables in rollback commands (git clean -fd -e .agents/teamwork/ -e projects/).
3. Update FSM architecture (16 states, state transitions, victory audit livelock fix, fast-track transition, bounded Gate 2, escalation ordering).
4. Add complete TypeScript interfaces (IPalProvider, PalSessionOptions, PalOutcome, PalStreamEvent, PalTokenUsage, PalRateLimitInfo, PalErrorKind, PalError, strict turn payload types, tool execution context, role enums).
5. Add provider invariant mitigations (turn folding, atomic tool batch resolution, Gemini struct wrapping, ReAct truncation watchdog, rate limiter math with jitter).

Verify the updated file, write your handoff report to /home/sastiam/Workspace/openspec-cascade/.agents/teamwork/worker_m1_2/handoff.md, and send a message when complete.
