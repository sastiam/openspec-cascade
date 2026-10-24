# Project: Provider-Agnostic Multi-Agent Looper (Agnostic Looper)

## Architecture
The system is an autonomous multi-agent looping engine inspired by Antigravity Teamwork, decoupling execution across cognitive roles:
- **Sentinel**: Permanent high-level watcher managing user context and final victory audit.
- **Orchestrator**: Ephemeral coordinator that decomposes tasks, dispatches subagents, monitors gates, and self-succeeds at 16 spawns.
- **Explorer**: Read-only specialist that builds verified evidence chains without modifying state.
- **Worker**: Context-bound implementer executing tasks and emitting handoff reports.
- **Reviewer**: Read-only semantic verifier checking spec compliance and code standards.
- **Adversarial Challenger**: Red-team empirical verifier generating test harnesses, stress probes, and edge-case fuzzers.
- **Forensic Auditor**: Binary veto authority enforcing global invariants, clean layouts, and authentic execution.

### Architectural Pillars:
1. **Deterministic State Machine**: FSM managing 16 non-terminal + 2 terminal loop phases (`PLAN_DECOMPOSE`, `DISPATCH_WORKER`, `EXECUTE_WORKER`, `GATE_0_AUTO`, `GATE_1_REVIEW`, `GATE_2_CHALLENGE`, `GATE_3_AUDIT`, `COMMIT_CHECKPOINT`, `ROLLBACK_RECOVERY`, `SUCCESSION`, `STATE_DISPATCH_EXPLORER`, `STATE_EXECUTE_EXPLORER`, `STATE_ESCALATE_DIAGNOSTIC`, `STATE_VICTORY_TRIAGE`, `COMPLETED`, `FAILED`).
2. **Provider Abstraction Layer (PAL)**: Hexagonal ports & adapters with canonical message types (`PalMessage`, `PalContentBlock`, `PalThoughtContent`, `PalToolDefinition`), turn normalizers, thought signature preservation, and tool calling bridges for Claude, Antigravity, and OpenCode.
3. **Objective Multi-Gate Verification**: 4-tier gating preventing broken state from polluting git history or moving downstream.
4. **Resilience & State Persistence**: File-based state in `.agents/teamwork/`, append-only logs (`DISPATCH.md`), lightweight working memory (`BRIEFING.md`), heartbeat liveness (`progress.md`), atomic git checkpointing (`RollbackStateBuffer` with `-e .agents/teamwork/ -e projects/`), and 16-spawn succession.
5. **Controlled GitHub Infrastructure**: Project #4 integration (`PVT_kwHOA0KY4s4Boie_`) with ambient `gh` CLI credentials, 4 mandatory Spanish sections, local catalog (`tasks_catalog.json`), and automated structural validation harness.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Looper Core FSM & State Engine | Event-driven lifecycle, task loop, transitions, retry budgets | M1 | Explorer 1 |
| F02 | Cognitive Role Matrix & Dispatch Protocol | Formal role definitions (Sentinel, Orch, Worker, Reviewer, Challenger, Auditor) | M1 | Explorer 1 |
| F03 | 4-Tier Objective Verification Gates | Gate 0 (Auto/QA), Gate 1 (Review), Gate 2 (Challenger), Gate 3 (Forensic Veto) | M1 | Explorer 1 |
| F04 | Rollback & Git State Checkpointing | Atomic git snapshotting, rollback buffer, clean on failure | M1 | Explorer 1 |
| F05 | Autonomous Routing & Escalation Ladder | Dynamic routing, 6-rung escalation ladder from local retry to Sentinel | M1 | Explorer 1 |
| F06 | Persistent Memory & Succession Pattern | BRIEFING.md, progress.md heartbeats, 16-spawn orchestrator succession | M1 | Explorer 1 |
| F07 | Canonical Message & Content Block Schema | PalMessage, PalContentBlock, text, thought, tool_call, tool_result | M1 | Explorer 2 |
| F08 | Bi-directional Turn Normalizers | Mappings for Anthropic alternating turns, Gemini contents/parts, OpenAI/OpenCode messages | M1 | Explorer 2 |
| F09 | Extended Thinking & Audit Trace Contracts | PalThoughtContent signature preservation, reasoning token handling | M1 | Explorer 2 |
| F10 | Unified Tool Bridge & ReAct Fallback | JSON Schema Draft 7/2020-12, MCP bridge, ReAct fallback for local models | M1 | Explorer 2 |
| F11 | Capability Matrix & Adaptive Rate Limiter | PalCapabilityMatrix, token bucket, reset-time parsing, context overflow triggers | M1 | Explorer 2 |
| F12 | Comprehensive Tech Spec Deliverable | Complete SPECIFICATION.md written to projects/agnostic_looper | M1 | ORIGINAL_REQUEST R1 |
| F13 | Modular Task Decomposition Matrix | Engineering breakdown into core engine, PAL, verification, and CLI streams | M2 | ORIGINAL_REQUEST R2 |
| F14 | GitHub Project #4 Population | Creating all tasks as discrete items in sastiam Project #4 via gh CLI / GraphQL | M2 | ORIGINAL_REQUEST R2 |
| F15 | Strict 4-Section Spanish Formatting | Propósito, Qué se espera lograr, Goal, Criterios de completitud in every item | M2 | ORIGINAL_REQUEST R2 |
| F16 | Local Catalog File Generation | Writing tasks_catalog.json and tasks_catalog.md to projects/agnostic_looper | M2 | ORIGINAL_REQUEST R3 |
| F17 | Automated Verification Script | Programmatic verification script (verify_project_items.ts/.py) | M3 | ORIGINAL_REQUEST R3 |
| F18 | GitHub Project #4 Structural Validation Run | Executing verification to assert 100% compliance of items in Project #4 | M3 | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Technical Architecture Specification Deliverable | Features F01–F12: Comprehensive SPECIFICATION.md in projects/agnostic_looper | Phase 0 Survey | DONE (Gate passed, 1073 lines, 80 KB) |
| M2 | GitHub Project #4 Tasks Creation & Local Catalog | Features F13–F16: Task breakdown, item creation in Project #4, tasks_catalog.json/md | M1 | DONE (16 items created in Project #4, catalogs generated) |
| M3 | Verification Harness & Quality Gate Validation | Features F17–F18: Automated verification script execution, structural audit | M2 | DONE (Auditor CLEAN, 16/16 verified 100%) |

## Interface Contracts
### Looper Core ↔ Provider Abstraction Layer (PAL)
- Core calls `pal.executeTurn(sessionOptions: PalSessionOptions): Promise<PalOutcome>`
- Streaming via `pal.streamTurn(sessionOptions: PalSessionOptions): AsyncIterable<PalStreamChunk>`
- Standardized error codes: `PAL_RATE_LIMITED`, `PAL_CONTEXT_OVERFLOW`, `PAL_AUTH_ERROR`, `PAL_TOOL_FAILED`

### Looper Core ↔ Verification Harness
- Gate 0: `runGate0(cwd: string, commands: string[]): Promise<GateResult>`
- Gate 1: `dispatchReviewer(diff: string, criteria: string[]): Promise<ReviewVerdict>`
- Gate 2: `dispatchChallenger(target: string, invariants: string[]): Promise<ChallengerVerdict>`
- Gate 3: `dispatchAuditor(deliverables: string[]): Promise<AuditorVerdict>`

### Local Catalog ↔ GitHub Project #4
- Input: Array of Task Definitions with 4 Spanish sections
- Mutation: `gh project item-create 4 --owner sastiam` or GraphQL `addProjectV2DraftIssue`
- Catalog format: `tasks_catalog.json` with fields `id`, `project_item_id`, `title`, `status`, `workstream`, `sections_present`, `url`

## Code Layout
- Deliverables Directory: `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/`
  - `SPECIFICATION.md`: Master architectural specification (1073 lines)
  - `tasks_catalog.json`: Machine-readable catalog of 16 GitHub Project #4 items
  - `tasks_catalog.md`: Human-readable catalog of 16 GitHub Project #4 items
  - `verify_project_items.ts`: Verification script querying GitHub Project #4 and validating all items
- Metadata Directory: `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/`
  - `teamwork_preview_orchestrator_1/`: Orchestrator state (BRIEFING, plan, progress, PROJECT, GATE_STATUS, handoff)
