# Master Technical Architecture Specification: Provider-Agnostic Multi-Agent Looper ("Agnostic Looper")

**Document Version**: 1.0.0-PROD  
**Status**: PROPOSED SPECIFICATION (PENDING REVIEW GATES)  
**Target Project**: Agnostic Multi-Agent Looper inspired by Antigravity Teamwork  
**Working Directory**: `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper`  
**GitHub Project Reference**: [https://github.com/users/sastiam/projects/4](https://github.com/users/sastiam/projects/4) (Node ID: `PVT_kwHOA0KY4s4Boie_`)  
**Parent Orchestrator**: `teamwork_preview_orchestrator_1`  
**Author**: Worker M1.1 (Technical Architecture Specification Author)  
**Date**: 2026-10-24  

---

## Table of Contents
1. [Executive Summary & System Vision](#1-executive-summary--system-vision)
   - 1.1 Core Objectives & Problem Statement
   - 1.2 Design Philosophy & Invariants
   - 1.3 Inspiration from Antigravity Teamwork
   - 1.4 High-Level System Architecture
2. [Looper Engine Architecture & Lifecycle](#2-looper-engine-architecture--lifecycle)
   - 2.1 Event-Driven Finite State Machine (FSM)
   - 2.2 FSM State Definitions & Transition Matrix
     - 2.2.1 State Definitions
     - 2.2.2 State Transition Matrix
     - 2.2.3 Victory Audit Livelock Elimination Protocol
   - 2.3 Autonomous Task Routing Engine
   - 2.4 Cognitive Role Specialization Matrix (6 Tiers)
   - 2.5 Dynamic Escalation Ladder (6 Rungs)
3. [Objective 4-Tier Verification Gates](#3-objective-4-tier-verification-gates)
   - 3.1 The "Harness as Oracle" Axiom
   - 3.2 Gate 0: Automated Oracle / Mechanical QA Checks
   - 3.3 Gate 1: Independent Semantic Code Review
   - 3.4 Gate 2: Adversarial Challenger Red-Teaming
   - 3.5 Gate 3: Forensic Auditor Binary Veto
   - 3.6 Gate Execution Policies: Fast-Track vs. Full-Gate
4. [Provider Abstraction Layer (PAL) Interface Contracts](#4-provider-abstraction-layer-pal-interface-contracts)
   - 4.1 Hexagonal Architecture (Ports & Adapters)
     - 4.1.1 Standardized PAL Error Taxonomy
   - 4.2 Canonical Message & Content Block Data Model
   - 4.3 Bi-directional Turn Normalizers & Invariant Resolution
     - 4.3.1 Turn-Folding Invariant (Claude & Gemini Alternation)
     - 4.3.2 Atomic Tool Batch Resolution Invariant
     - 4.3.3 Gemini Protobuf Struct Invariant
   - 4.4 Extended Thinking & Cryptographic Signature Contracts
   - 4.5 Unified Tool Definition, MCP Bridge & ReAct Fallback
     - 4.5.1 Model Context Protocol (MCP) Bridge
     - 4.5.2 ReAct Fallback Engine & Truncation Watchdog
   - 4.6 Capability Negotiation Matrix & Leaky-Bucket Rate Limiter
     - 4.6.1 Mathematical Rate Limiting Model & Concurrency Semaphore
5. [State Persistence, Resilience & Fault Tolerance](#5-state-persistence-resilience--fault-tolerance)
   - 5.1 File-Based Memory Hierarchy in `.agents/teamwork/`
   - 5.2 Working Tree Isolation, Git Snapshotting & Atomic Rollback
   - 5.3 Context Succession Pattern (The 16-Spawn Rule & Mid-Execution Invariant)
   - 5.4 Idempotent Crash Recovery & Stale Agent Detection
6. [Engineering Work Stream Decomposition Matrix](#6-engineering-work-stream-decomposition-matrix)
   - 6.1 Stream 1: Core Engine & Lifecycle State Machine
   - 6.2 Stream 2: Provider Abstraction Layer (PAL) & Normalizers
   - 6.3 Stream 3: Objective 4-Tier Verification Harness & Rollback Buffer
   - 6.4 Stream 4: CLI, State Persistence & GitHub Project #4 Integration
   - 6.5 GitHub Project #4 Governance & Structural Validation Standards
7. [Appendix & References](#7-appendix--references)

---

## 1. Executive Summary & System Vision

### 1.1 Core Objectives & Problem Statement
Autonomous AI coding agents frequently fall into failure loops when operating in complex enterprise codebases. Existing single-agent looping harnesses (such as classic iterative script runners) suffer from three fatal deficiencies:
1. **Confirmation Bias & Cognitive Lock-In**: A single agent responsible for analyzing requirements, implementing code, and self-evaluating changes will consistently rationalize its own errors, repeatedly attempting minor variations of flawed implementations.
2. **LLM Self-Attestation Vulnerability**: Systems that rely on LLM self-evaluation ("I have completed the task") suffer from hallucinations, silently marking broken or untested code as finished.
3. **Provider Lock-In & Semantic Friction**: Coding frameworks coupled to a single vendor (e.g. Anthropic Claude, Google Gemini, or OpenAI) cannot exploit heterogeneous model capabilities (such as Gemini's 2-million-token context for whole-repo analysis combined with Claude 3.7's extended thinking for critical algorithm design or local open-weights models for air-gapped tasks).

The **Provider-Agnostic Multi-Agent Looper ("Agnostic Looper")** solves these limitations by implementing an autonomous, deterministic, multi-agent looping architecture with strict separation of cognitive powers, objective multi-tier verification gates, and a universal Provider Abstraction Layer (PAL).

### 1.2 Design Philosophy & Invariants
The Agnostic Looper adheres to five non-negotiable architectural axioms:
1. **The Harness and Gates are the Oracle**: An agent's self-assessment is never trusted. Completion is determined strictly through deterministic mechanical tests (Gate 0), independent semantic review (Gate 1), red-team adversarial challenges (Gate 2), and binary forensic audits (Gate 3).
2. **Files for Content, Messages for Coordination**: High-volume diagnostic data, reports, code diffs, and context transfers are written to the filesystem. Inter-agent messages are reserved strictly for high-level coordination and control signals.
3. **Strict Separation of Cognitive Concerns**: Workers write code; Reviewers critique; Challengers attack; Auditors enforce global invariants; Orchestrators plan; Sentinels monitor. No single agent ever performs multiple conflicting roles within the same task lifecycle.
4. **Zero Dirty Repository History**: Unverified changes must never pollute the git working tree or commit log. Every task operates against an atomic baseline snapshot; any task that fails gate verification is hard-reset (`git reset --hard && git clean -fd -e .agents/teamwork/ -e projects/`) before recovery or escalation, strictly preserving agent memory and project assets.
5. **Provider Agnosticism with Native Fidelity**: The system presents a unified, canonical interface for all agents, while adapters preserve each provider's native superpowers (extended thinking, prompt caching, tool-use IDs, massive context windows).

### 1.3 Inspiration from Antigravity Teamwork
The system draws its organizational foundation from **Antigravity Teamwork** (`https://antigravity.google/docs/teamwork/`), industrializing multi-agent choreography:
- **Hierarchical Cognitive Delegation**: High-level Sentinels remain ultra-lean, offloading tactical planning to Orchestrators, which delegate isolated tasks to Workers and Explorers.
- **Persistent Working Memory (`BRIEFING.md`)**: Agents maintain compact, structured situational memory (<100 lines) with append-only 🔒 sections (`## 🔒 My Identity`, `## 🔒 Key Constraints`) that survive context truncations.
- **Heartbeat Telemetry (`progress.md`)**: Agents write timestamped liveness updates (`Last visited: [timestamp]`) every 5 minutes to prevent hung processes and enable automated watchdog recovery.
- **5-Component Handoff Protocol**: All context transfer occurs via structured reports containing: Observation, Logic Chain, Caveats, Conclusion, and Verification Method.
- **16-Spawn Context Succession**: Ephemeral Orchestrators self-succeed every 16 agent dispatches, preventing context degradation and cognitive drift without losing state.

### 1.4 High-Level System Architecture

```
                                  ┌────────────────────────────────────────────────────────┐
                                  │                  Sentinel Agent                        │
                                  │   (Ultra-lean Context, Liveness Cron, Victory Sign-off)│
                                  └───────────────────────────┬────────────────────────────┘
                                                              │
                                                              ▼
                                  ┌────────────────────────────────────────────────────────┐
                                  │                Orchestrator Agent                      │
                                  │       (Task DAG Scheduler, Dispatcher, 16-Spawn)       │
                                  └─────────────┬────────────────────────────┬─────────────┘
                                                │                            │
                     ┌──────────────────────────┴────────┐                   │
                     ▼                                   ▼                   ▼
      ┌─────────────────────────────┐     ┌─────────────────────────────┐  ┌─────────────────────────────┐
      │       Explorer Agent        │     │        Worker Agent         │  │     Successor Agent         │
      │  (Read-only Root Cause,     │     │ (Code Modification, TDD,    │  │ (Context Continuation,      │
      │   Codebase Topology Maps)   │     │  Local Refactorings)        │  │  State Inheritance)         │
      └─────────────────────────────┘     └──────────────┬──────────────┘  └─────────────────────────────┘
                                                         │
                                                         ▼
                                  ┌────────────────────────────────────────────────────────┐
                                  │          Objective 4-Tier Verification Gates           │
                                  │                                                        │
                                  │   [Gate 0: Mechanical QA]   bun test / tsc / lint      │
                                  │             │ Pass                                     │
                                  │   [Gate 1: Reviewer Agent]  Spec & Quality Audit       │
                                  │             │ Pass                                     │
                                  │   [Gate 2: Challenger Agent] Red-Team Adversarial Fuzz │
                                  │             │ Pass                                     │
                                  │   [Gate 3: Forensic Auditor] Binary Veto & Invariants  │
                                  └─────────────┬────────────────────────────┬─────────────┘
                                                │ Pass                       │ Fail (Max Retries)
                                                ▼                            ▼
                                  ┌─────────────────────────────┐  ┌─────────────────────────────┐
                                  │   Commit & Checkpoint       │  │ Atomic RollbackStateBuffer  │
                                  │  Conventional Commits       │  │ (git reset --hard && clean) │
                                  └─────────────────────────────┘  └──────────────┬──────────────┘
                                                                                  │
                                                                                  ▼
                                                                   ┌─────────────────────────────┐
                                                                   │ 6-Rung Escalation Ladder    │
                                                                   └─────────────────────────────┘
                                                │
                                                ▼
 ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
                                  Provider Abstraction Layer (PAL)
 ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
                 ┌──────────────────────────────┼──────────────────────────────┐
                 ▼                              ▼                              ▼
    ┌──────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
    │      Claude Adapter      │   │   Antigravity Adapter    │   │     OpenCode Adapter     │
    │  • Anthropic Messages    │   │  • Gemini GenAI API      │   │  • Ollama / vLLM API     │
    │  • Extended Thinking     │   │  • Antigravity CLI (agy) │   │  • OpenCode CLI (ACP)    │
    │  • Ephemeral Cache       │   │  • 2M Context Windows    │   │  • ReAct Fallback Parser │
    └──────────────────────────┘   └──────────────────────────┘   └──────────────────────────┘
```

---

## 2. Looper Engine Architecture & Lifecycle

### 2.1 Event-Driven Finite State Machine (FSM)
The Looper Core operates as a strictly typed, deterministic Finite State Machine (FSM). State transitions are triggered by explicit, validated domain events. Invalid transitions throw fatal `InvalidStateTransitionError` exceptions, preventing execution corruption.

```
                                  +-----------------------+
                                  |      STATE_INIT       |
                                  +-----------+-----------+
                                              | EVT_INIT_SUCCESS
                                              v
                                  +-----------------------+
                     +----------->|  STATE_PLAN_DECOMPOSE |<----------+
                     |            +-----------+-----------+           |
                     |                        | EVT_TASK_SELECTED     |
                     |                        v                       |
                     |            +-----------------------+           |
                     |            |  STATE_DISPATCH_WORKER|           |
                     |            +-----------+-----------+           |
                     |                        | EVT_WORKER_SPAWNED    |
                     |                        v                       |
                     |            +-----------------------+           |
                     |            |  STATE_EXECUTE_WORKER |           |
                     |            +-----------+-----------+           |
                     |                        | EVT_WORK_SUBMITTED    |
                     |                        v                       |
                     |            +-----------------------+           |
                     |            |   STATE_GATE_0_AUTO   |           |
                     |            +-----+-----------+-----+           |
                     |  EVT_G0_PASS     |           | EVT_G0_FAIL     |
                     |                  v           v                 |
                     |     +--------------+   +--------------+        |
                     |     | STATE_GATE_1 |   | STATE_RETRY_ |        |
                     |     |    REVIEW    |   |   TRIAGE     |--------+ (Exhausted -> Rollback)
                     |     +------+-------+   +--------------+        |
                     |EVT_G1_PASS |           EVT_G1_FAIL             |
                     |            v           +-----------------------+
                     |     +--------------+
                     |     | STATE_GATE_2 |
                     |     |  CHALLENGER  |
                     |     +------+-------+
                     |EVT_G2_PASS |           EVT_G2_FAIL
                     |            v           +-----------------------+
                     |     +--------------+
                     |     | STATE_GATE_3 |
                     |     | FORENSIC_VETO|
                     |     +------+-------+
                     |EVT_G3_PASS |           EVT_G3_VETO
                     |            v           +-----------------------+
                     |     +--------------+
                     |     | STATE_COMMIT |
                     |     |  CHECKPOINT  |
                     |     +------+-------+
                     |            | EVT_CHECKPOINT_COMMITTED
                     |            v
                     |     +--------------+
                     +-----+ MORE TASKS?  |
                      YES  +------+-------+
                                  | NO (EVT_ALL_TASKS_DONE)
                                  v
                           +--------------+  EVT_VICTORY_FAIL   +---------------+
                           | STATE_VICTORY| ------------------> | STATE_VICTORY |
                           |    AUDIT     |                     |    TRIAGE     |
                           +------+-------+                     +-------+-------+
                                  | EVT_VICTORY_PASS                    | Re-open culprit tasks
                                  v                                     v
                           +--------------+                  (To STATE_PLAN_DECOMPOSE)
                           |STATE_COMPLETE|
                           +--------------+
```

### 2.2 FSM State Definitions & Transition Matrix

#### 2.2.1 State Definitions
- `STATE_INIT`: Validates environment, verifies Git cleanliness, resolves PAL provider authentication, reads configuration.
- `STATE_PLAN_DECOMPOSE`: Parses task graph (`PROJECT.md` / `tasks.md`), determines next topological task, captures Git baseline snapshot in `RollbackStateBuffer`. Evaluates succession thresholds prior to task dispatch.
- `STATE_DISPATCH_WORKER`: Creates isolated agent workspace (`.agents/teamwork/worker_<id>`), prepares contextual prompt with task criteria and skills, launches Worker in mutation-capable sandbox.
- `STATE_EXECUTE_WORKER`: Worker executes changes. Worker is strictly sandboxed: no direct Git commit, no push, no direct gate manipulation.
- `STATE_DISPATCH_EXPLORER`: Creates isolated agent workspace (`.agents/teamwork/explorer_<id>`), prepares investigation prompt with read-only guidelines, launches Explorer.
- `STATE_EXECUTE_EXPLORER`: Explorer conducts read-only codebase mapping, diagnostic root-cause analysis, or architectural research. Strictly zero code mutation permissions.
- `STATE_GATE_0_AUTO`: Harness executes mechanical verification suite (`bun test`, `tsc --noEmit`, linters). Returns deterministic stdout/stderr traces.
- `STATE_GATE_1_REVIEW`: Independent Reviewer inspects diff, checks specification compliance, architectural rules, and test cleanliness.
- `STATE_GATE_2_CHALLENGE`: Adversarial Challenger generates fuzz probes, boundary inputs, and edge cases to stress-test the implementation (bounded by `MaxChallengeAttempts`).
- `STATE_GATE_3_AUDIT`: Independent Forensic Auditor executes project invariant checks and exercises binary veto authority.
- `STATE_COMMIT_CHECKPOINT`: If all required gates pass, harness formats Conventional Commit message, stages files, commits SHA, updates catalog and task status (`- [x]`).
- `STATE_ESCALATE_DIAGNOSTIC`: Invoked upon gate rejection prior to working tree rollback. Preserves dirty working tree so Challenger (Rung 2) can reproduce failure and Explorer (Rung 3) can diagnose root causes and synthesize `remediation.patch`.
- `STATE_ROLLBACK_RECOVERY`: Harness triggers atomic rollback (`git reset --hard ${baselineSha} && git clean -fd -e .agents/teamwork/ -e projects/`), eradicating broken artifacts while preserving agent memory, and engages clean replacement (Rung 4) or re-decomposition (Rung 5).
- `STATE_VICTORY_TRIAGE`: Engaged if `STATE_VICTORY_AUDIT` detects regressions. Isolates failing subsystems, re-opens culprit DAG tasks (reverting `- [x]` to `- [ ]` or generating regression remediation tasks), preventing livelock cycles.
- `STATE_SUCCESSION`: Orchestrator checks spawn count ($\ge 16$) or token budget ($\ge 80\%$) at task boundaries. Spawns successor orchestrator and delegates control cleanly.
- `STATE_VICTORY_AUDIT`: After all tasks finish, Sentinel invokes a final holistic auditor across the entire repository before declaring victory.
- `STATE_COMPLETED`: Terminal success state. Emits final summary, task catalog, and execution metrics.
- `STATE_ABORTED`: Terminal failure state. Engaged only when fatal unrecoverable errors occur or human intervention is required at Rung 6 (`BLOCKED`).

#### 2.2.2 State Transition Matrix
| Current State | Allowed Next States | Trigger Event | Guard Condition |
| :--- | :--- | :--- | :--- |
| `STATE_INIT` | `STATE_PLAN_DECOMPOSE`<br>`STATE_ABORTED` | `EVT_INIT_SUCCESS`<br>`EVT_FATAL_ERROR` | Git status clean, PAL providers healthy.<br>Missing auth, corrupted env, or fatal init error. |
| `STATE_PLAN_DECOMPOSE` | `STATE_DISPATCH_WORKER`<br>`STATE_DISPATCH_EXPLORER`<br>`STATE_VICTORY_AUDIT`<br>`STATE_SUCCESSION` | `EVT_TASK_SELECTED_WORKER`<br>`EVT_TASK_SELECTED_EXPLORER`<br>`EVT_ALL_TASKS_DONE`<br>`EVT_SPAWN_LIMIT` | Next task is implementation (`role === "worker"`).<br>Next task is exploration (`role === "explorer"`).<br>All tasks marked `- [x]`.<br>Spawn count $\ge 16$ or tokens $\ge 80\%$. |
| `STATE_DISPATCH_WORKER` | `STATE_EXECUTE_WORKER`<br>`STATE_ROLLBACK_RECOVERY` | `EVT_WORKER_SPAWNED`<br>`EVT_SPAWN_FAILED` | Worker workspace created successfully.<br>Subagent launch failed or timed out. |
| `STATE_EXECUTE_WORKER` | `STATE_GATE_0_AUTO`<br>`STATE_ESCALATE_DIAGNOSTIC` | `EVT_WORK_SUBMITTED`<br>`EVT_WORKER_TIMEOUT` | Worker emitted completion signal.<br>Worker hung or exceeded time limit. |
| `STATE_DISPATCH_EXPLORER`| `STATE_EXECUTE_EXPLORER`<br>`STATE_ESCALATE_DIAGNOSTIC`| `EVT_EXPLORER_SPAWNED`<br>`EVT_SPAWN_FAILED`| Explorer workspace created successfully.<br>Process launch failed. |
| `STATE_EXECUTE_EXPLORER` | `STATE_GATE_3_AUDIT`<br>`STATE_ESCALATE_DIAGNOSTIC` | `EVT_EXPLORATION_COMPLETE`<br>`EVT_EXPLORER_TIMEOUT` | Explorer produced analysis/handoff report.<br>Explorer process hung or timed out. |
| `STATE_GATE_0_AUTO` | `STATE_GATE_1_REVIEW`<br>`STATE_GATE_3_AUDIT`<br>`STATE_EXECUTE_WORKER`<br>`STATE_ESCALATE_DIAGNOSTIC` | `EVT_G0_PASS`<br>`EVT_G0_PASS_FAST_TRACK`<br>`EVT_G0_RETRY`<br>`EVT_G0_EXHAUSTED` | Exit code 0 for all checks (Full-Gate policy).<br>Exit code 0 and `isFastTrack(task) === true`.<br>Exit code $\ne 0$ and Attempts < MaxAttempts (default: 3).<br>Attempts $\ge$ MaxAttempts (preserves dirty diff for Rungs 2–3). |
| `STATE_GATE_1_REVIEW` | `STATE_GATE_2_CHALLENGE`<br>`STATE_EXECUTE_WORKER`<br>`STATE_ESCALATE_DIAGNOSTIC` | `EVT_G1_PASS`<br>`EVT_G1_REVISE`<br>`EVT_G1_REJECT` | Reviewer verdict `APPROVED`.<br>Reviewer requested revisions (Attempts < MaxAttempts).<br>Severe violations or attempts exhausted. |
| `STATE_GATE_2_CHALLENGE` | `STATE_GATE_3_AUDIT`<br>`STATE_EXECUTE_WORKER`<br>`STATE_ESCALATE_DIAGNOSTIC` | `EVT_G2_PASS`<br>`EVT_G2_BREAK`<br>`EVT_G2_EXHAUSTED` | Challenger failed to break implementation.<br>Breaking test found (Attempts < MaxChallengeAttempts, default: 2).<br>Attempts $\ge$ MaxChallengeAttempts (prevents infinite ping-pong). |
| `STATE_GATE_3_AUDIT` | `STATE_COMMIT_CHECKPOINT`<br>`STATE_ESCALATE_DIAGNOSTIC` | `EVT_G3_PASS`<br>`EVT_G3_VETO` | Forensic Auditor verified all invariants.<br>Auditor exercised binary veto. |
| `STATE_ESCALATE_DIAGNOSTIC`| `STATE_EXECUTE_WORKER`<br>`STATE_ROLLBACK_RECOVERY`<br>`STATE_ABORTED` | `EVT_DIAGNOSTIC_RETRY`<br>`EVT_ROLLBACK_REQUIRED`<br>`EVT_ESCALATION_FATAL` | Challenger produced repro script; fed to active Worker (Rung 2).<br>Explorer produced `remediation.patch` or diagnostic finished; ready for rollback (Rungs 3–4).<br>Unrecoverable architectural failure; escalate to Sentinel (Rung 6). |
| `STATE_ROLLBACK_RECOVERY`| `STATE_DISPATCH_WORKER`<br>`STATE_PLAN_DECOMPOSE`<br>`STATE_ABORTED` | `EVT_ESCALATION_RESOLVED`<br>`EVT_REDECOMPOSE_REQUIRED`<br>`EVT_ESCALATION_FAILED` | Working tree reset; fresh Worker spawned with Explorer patch (Rung 4).<br>Task flagged as compound; returning to DAG for splitting (Rung 5).<br>Escalation exhausted; task marked `BLOCKED` (Rung 6). |
| `STATE_COMMIT_CHECKPOINT`| `STATE_PLAN_DECOMPOSE`<br>`STATE_SUCCESSION` | `EVT_CHECKPOINT_COMMITTED`<br>`EVT_SPAWN_LIMIT` | Git commit successful; checkbox marked `- [x]`.<br>Spawn counter $\ge 16$ or tokens $\ge 80\%$. |
| `STATE_SUCCESSION` | `STATE_PLAN_DECOMPOSE` | `EVT_SUCCESSION_COMPLETE` | Successor initialized; context handed over cleanly. |
| `STATE_VICTORY_AUDIT` | `STATE_COMPLETED`<br>`STATE_VICTORY_TRIAGE` | `EVT_VICTORY_PASS`<br>`EVT_VICTORY_FAIL` | Entire project passes final holistic audit.<br>Regressions found in end-to-end integration. |
| `STATE_VICTORY_TRIAGE` | `STATE_PLAN_DECOMPOSE`<br>`STATE_ABORTED` | `EVT_TRIAGE_REOPENED`<br>`EVT_TRIAGE_BLOCKED` | Culprit tasks unmarked to `- [ ]` or remediation tasks injected.<br>Unrecoverable systemic breakdown; Sentinel escalates to human. |

#### 2.2.3 Victory Audit Livelock Elimination Protocol
To prevent infinite cycling between `STATE_VICTORY_AUDIT` and `STATE_PLAN_DECOMPOSE`:
1. When `STATE_VICTORY_AUDIT` emits `EVT_VICTORY_FAIL`, transition to `STATE_VICTORY_TRIAGE` (never directly to rollback).
2. The triage engine parses integration test failures and identifies the affected modules.
3. The triage engine updates `PROJECT.md`, explicitly re-opening the culprit tasks by toggling their status from `- [x]` to `- [ ]` or appending a targeted regression remediation task:
   `- [ ] [REGRESSION-FIX] Resolve integration failure in <module>`
4. Only when at least one task in the DAG is active (`- [ ]`) does the FSM transition to `STATE_PLAN_DECOMPOSE`.
5. If the triage engine cannot isolate the regression or if a task has failed victory audit twice, it emits `EVT_TRIAGE_BLOCKED`, transitioning to `STATE_ABORTED` and flagging the failure for human intervention.

### 2.3 Autonomous Task Routing Engine
The Autonomous Task Router evaluates incoming tasks and failure profiles to determine agent assignment without human involvement:

```typescript
export type CognitiveRole =
  | "sentinel"
  | "orchestrator"
  | "explorer"
  | "worker"
  | "reviewer"
  | "challenger"
  | "auditor";

export type GateTierPolicy = "fast_track" | "full_gate";

export interface TaskRoutingPolicy {
  classifyTask(taskDescription: string): CognitiveRole;
  determineGateTier(taskDescription: string, affectedFiles: string[]): GateTierPolicy;
  selectModelForRole(role: CognitiveRole, fallbackChain: string[]): string;
}
```

1. **Semantic Classification**:
   - `EXPLORATION`: Tasks containing `"explore"`, `"investigate"`, `"diagnose"`, `"benchmark"`, `"map"` $\rightarrow$ Dispatched to **Explorer**.
   - `IMPLEMENTATION`: Tasks containing `"implement"`, `"create"`, `"fix"`, `"refactor"`, `"build"` $\rightarrow$ Dispatched to **Worker**.
   - `EVALUATION`: Tasks containing `"review"`, `"audit"`, `"challenge"`, `"verify"` $\rightarrow$ Dispatched to **Reviewer** / **Auditor**.
2. **Dynamic Model Routing**:
   - High-throughput / Context-heavy tasks $\rightarrow$ Google Gemini 1.5 Pro / 2.0 Flash (2M context).
   - Architectural reasoning / Critical algorithm design $\rightarrow$ Claude 3.7 Sonnet (Extended Thinking enabled).
   - Sensitive / Internal / Code generation tasks $\rightarrow$ OpenCode / DeepSeek R1 / Local vLLM.

### 2.4 Cognitive Role Specialization Matrix (6 Tiers)

| Role Tier | Archetype | Core Responsibility | Permissions | Inputs | Primary Outputs |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 0** | **Sentinel** | Guardian of project lifecycle, liveness monitor, human escalation gate, final victory sign-off. | Read metadata, schedule crons, spawn victory auditor. **No code edit.** | User request, global progress, heartbeat crons. | Escalation alerts, final project sign-off. |
| **Tier 1** | **Orchestrator** | Task decomposition, dependency DAG tracking, subagent dispatch, 16-spawn succession. | Write own folder, dispatch subagents, update plans. **No direct code edit or test running.** | `PROJECT.md`, `tasks.md`, agent handoffs. | Dispatch manifests (`DISPATCH.md`), task assignments. |
| **Tier 2** | **Explorer** | Codebase mapping, read-only root-cause diagnosis, architectural survey, patch proposals. | Read all repository files, write own folder. **Zero code mutations.** | Dispatch instructions, codebase, test logs. | 5-component `handoff.md`, diagnostic `.patch` proposals. |
| **Tier 3** | **Worker** | Code implementation, local refactoring, TDD execution, unit test authoring. | Write workspace code files, run local build/test commands. **No Git commit or push.** | Task definition, in-repo skills, compiler errors. | Working tree diffs, local test results, handoff reports. |
| **Tier 4** | **Reviewer** | Semantic verification, spec fidelity, zero regressions, architectural compliance. | Read all repository files, read git diffs, write review report. **No code edit.** | Git diff, task criteria, architecture specs. | Review verdict (`APPROVED` / `REVISION_REQUIRED`). |
| **Tier 5** | **Adversarial Challenger** | Red-team stress testing, edge-case generation, boundary fuzzing, breaking reproduction authoring. | Read repository files, execute test runners with dynamic test probes. | Implemented code, task specs, API schemas. | Challenge verdict + executable reproduction scripts. |
| **Tier 6** | **Forensic Auditor** | Independent binary veto, repository invariant enforcement, layout rule compliance. | Run system verification scripts, execute git audit tools. **Holds binary veto.** | Working tree, full test suite, system invariants. | Binary verdict (`PASS` / `FAIL`). |

### 2.5 Dynamic Escalation Ladder (6 Rungs)
When a task fails verification, the looper engages a progressive 6-rung escalation ladder rather than blindly repeating identical prompts:

```
 [Gate Failure]
       │
       ▼
 ┌────────────┐
 │   Rung 1   │ ──> Local Mechanical Retry: Inject stdout/stderr traces back to Worker (Attempts 1..2).
 └─────┬──────┘     Working tree retained dirty.
       │ Failed twice
       ▼
 ┌────────────┐
 │   Rung 2   │ ──> Challenger Diagnostic: Working tree retained dirty! Dispatch Challenger to
 └─────┬──────┘     synthesize minimal reproduction script demonstrating failure. Feed script to Worker.
       │ Still failing
       ▼
 ┌────────────┐
 │   Rung 3   │ ──> Explorer Deep Dive: Working tree retained dirty! Worker suspended. Dispatch Explorer
 └─────┬──────┘     for read-only root-cause analysis across modules; generates `remediation.patch`.
       │ Diagnostic complete / attempts exhausted
       ▼
 ┌────────────┐
 │   Rung 4   │ ──> Clean Worker Replacement: Atomic rollback executed now:
 └─────┬──────┘     `git reset --hard ${baselineSha} && git clean -fd -e .agents/teamwork/ -e projects/`.
       │            Kill stuck Worker. Spawn fresh Worker initialized with Explorer's `remediation.patch`.
       │ Replacement fails
       ▼
 ┌────────────┐
 │   Rung 5   │ ──> Task Re-Decomposition: Orchestrator marks task as compound; splits into 2-3
 └─────┬──────┘     smaller sub-tasks in dependency DAG.
       │ Unresolvable ambiguity / external block
       ▼
 ┌────────────┐
 │   Rung 6   │ ──> Sentinel Human Escalation: Mark task `BLOCKED: <reason>`; notify Sentinel;
 └────────────┘     suspend task; proceed with independent DAG branches or await human input.
```

---

## 3. Objective 4-Tier Verification Gates

### 3.1 The "Harness as Oracle" Axiom
Under no circumstances is an AI agent permitted to attest to the validity of its own code. Claims such as *"I have verified the code and all tests pass"* are treated as untrusted text strings. A task can transition to `STATE_COMMIT_CHECKPOINT` **if and only if** all four verification gates produce certified positive verdicts.

```
       [Worker Code Changes]
                 │
                 ▼
     ┌───────────────────────┐
     │        GATE 0         │  ──> Automated Mechanical QA (bun test, tsc, lint, bash assertions)
     └───────────┬───────────┘      Deterministic, machine-executed, exit code 0 required.
                 │ PASS
                 ▼
     ┌───────────────────────┐
     │        GATE 1         │  ──> Semantic Reviewer Agent (Spec compliance, clean code, no regressions)
     └───────────┬───────────┘      Independent read-only LLM session auditing git diff.
                 │ PASS
                 ▼
     ┌───────────────────────┐
     │        GATE 2         │  ──> Adversarial Challenger Agent (Red-team fuzzing, edge-case probing)
     └───────────┬───────────┘      Synthesizes stress tests; must fail to break implementation.
                 │ PASS
                 ▼
     ┌───────────────────────┐
     │        GATE 3         │  ──> Forensic Victory Auditor (Global invariant verification, binary veto)
     └───────────┬───────────┘      Independent verification scripts, layout compliance.
                 │ PASS
                 ▼
   ┌───────────────────────────┐
   │ Commit & Checkpoint (Git) │
   └───────────────────────────┘
```

### 3.2 Gate 0: Automated Oracle / Mechanical QA Checks
- **Execution Engine**: Implemented via `qa.ts` (`runVerificationPhase`).
- **Commands**:
  1. TypeScript Compilation: `bunx tsc --noEmit` (Zero errors permitted).
  2. Test Suite Execution: `bun test <affected-specs>` (100% assertions passing).
  3. Linter & Layout: `eslint` / `biome` check + filesystem layout assertions (no source files inside `.agents/teamwork/`).
- **Feedback Mechanism**: If exit code $\ne 0$, stdout and stderr are sanitized, truncated to the relevant stack trace, formatted into XML tags (`<verification-feedback>`), and returned to the Worker.

### 3.3 Gate 1: Independent Semantic Code Review
- **Execution Engine**: Spawns an ephemeral `Reviewer` agent session with read-only repository access.
- **Audit Checklist**:
  1. **Specification Fidelity**: Does the change satisfy every item in the task's acceptance criteria?
  2. **Boundary Containment**: Did the worker modify files outside the authorized target scope?
  3. **Regression Risk**: Does the modification alter public API contracts or delete existing tests?
  4. **Code Quality**: Are there missing types, `any` leaks, undocumented side-effects, or memory leaks?
- **Output Verdict**: Emits a structured review verdict (`APPROVED` or `REJECTED: <reasons>`).

### 3.4 Gate 2: Adversarial Challenger Red-Teaming
- **Execution Engine**: Spawns an ephemeral `Adversarial Challenger` agent whose sole objective is to break the implementation.
- **Attack Vectors**:
  1. **Boundary & Malformed Inputs**: Null pointers, empty strings, $2^{31}-1$ integers, Unicode exploits, corrupted JSON payloads.
  2. **Concurrency & Race Conditions**: Parallel invocations, out-of-order event arrivals, async stream aborts.
  3. **Resource Exhaustion**: Extremely large input arrays, runaway loops, token window floods.
- **Rule of Engagement**: The Challenger generates a temporary test script (`test/challenger_<id>.test.ts`). If the Challenger successfully triggers an unhandled crash or assertion failure, the test is permanently added to the verification suite, Gate 2 fails, and the task reverts to the Worker.

### 3.5 Gate 3: Forensic Auditor Binary Veto
- **Execution Engine**: Spawns an independent `Forensic Auditor` subagent holding absolute binary veto authority.
- **Audit Mandate**:
  1. **Layout Invariant**: Ensure `.agents/teamwork/` contains exclusively metadata (`.md` files) and zero application source code or tests.
  2. **Git Hygiene**: Verify no unstaged secret keys, temporary `.tmp` files, or binary artifacts exist.
  3. **Independent Script Run**: Auditor re-runs the end-to-end verification script from a clean shell sub-process without inheriting environment overrides.
  4. **Binary Decision**: If any invariant is violated, the Auditor issues an immediate `VETO`. The harness triggers `RollbackStateBuffer.rollback()`, reverting the codebase to the baseline snapshot.

### 3.6 Gate Execution Policies: Fast-Track vs. Full-Gate
To optimize token economy and cycle time:
- **Fast-Track Policy (Gates 0 & 3)**: Applied strictly to documentation, typo fixes, and standalone configuration tweaks. Gate 1 and Gate 2 are bypassed; Gate 0 (mechanical checks) and Gate 3 (invariant checks) must pass.
- **Full-Gate Policy (Gates 0, 1, 2, 3)**: Mandatory for all production source code modifications, architectural changes, cryptographic routines, and PAL adapter implementations.

---

## 4. Provider Abstraction Layer (PAL) Interface Contracts

### 4.1 Hexagonal Architecture (Ports & Adapters)
The Provider Abstraction Layer isolates the multi-agent looper from vendor-specific LLM APIs. The core looper depends exclusively on the port interface (`IPalProvider`), while pluggable adapters handle wire protocols, payload translations, and runtime quirks.

```
       ┌────────────────────────────────────────────────────────┐
       │             Multi-Agent Looper Core Engine             │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │                 IPalProvider (Port)                    │
       ├────────────────────────────────────────────────────────┤
       │ + executeTurn(options: PalSessionOptions): Promise...  │
       │ + streamTurn(options: PalSessionOptions): AsyncIterable│
       │ + getCapabilities(): PalProviderCapabilities           │
       │ + getRateLimitState(): PalRateLimitInfo                │
       └───────┬───────────────────┬───────────────────┬────────┘
               │                   │                   │
               ▼                   ▼                   ▼
    ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
    │   ClaudeAdapter    │ │ AntigravityAdapter │ │  OpenCodeAdapter   │
    │  (Anthropic API /  │ │  (Google Gemini /  │ │  (Ollama / vLLM /  │
    │   Claude Agent SDK)│ │   Antigravity CLI) │ │   OpenCode CLI)    │
    └────────────────────┘ └────────────────────┘ └────────────────────┘
```

```typescript
/**
 * Primary Port Interface for Provider Abstraction Layer (PAL)
 */
export interface IPalProvider {
  readonly providerName: "claude" | "antigravity" | "opencode";
  readonly modelName: string;

  /**
   * Execute a single turn synchronously to completion.
   */
  executeTurn(options: PalSessionOptions): Promise<PalOutcome>;

  /**
   * Stream turn tokens, thinking blocks, and tool call deltas in real-time.
   */
  streamTurn(options: PalSessionOptions): AsyncIterable<PalStreamEvent>;

  /**
   * Retrieve static and negotiated provider capabilities.
   */
  getCapabilities(): PalProviderCapabilities;

  /**
   * Retrieve current rate limiting window telemetry.
   */
  getRateLimitState(): PalRateLimitInfo;
}

/**
 * Options passed to each turn execution
 */
export interface PalSessionOptions {
  sessionId: string;
  messages: PalMessage[];
  systemPrompt?: string | Array<{ type: "text"; text: string; cacheControl?: { type: "ephemeral" } }>;
  tools?: PalToolDefinition[];
  toolChoice?: PalToolChoice;
  temperature?: number;
  maxTokens?: number;
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
  };
  abortSignal?: AbortSignal;
}

/**
 * Outcome returned from a completed turn
 */
export interface PalOutcome {
  message: PalMessage;
  finishReason: PalFinishReason;
  usage: PalTokenUsage;
  rateLimitInfo?: PalRateLimitInfo;
}

export type PalFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error";

/**
 * Token usage telemetry
 */
export interface PalTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
  thinkingTokens?: number;
}

/**
 * Rate limit window status
 */
export interface PalRateLimitInfo {
  requestsRemaining: number;
  requestsLimit: number;
  tokensRemaining: number;
  tokensLimit: number;
  resetsAt: number; // Unix timestamp in milliseconds
}

/**
 * Streaming event emitted during streamTurn()
 */
export type PalStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thought_delta"; thought: string }
  | { type: "tool_call_delta"; id: string; name?: string; argumentsDelta: string }
  | { type: "tool_call_end"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "turn_complete"; finishReason: PalFinishReason; usage: PalTokenUsage }
  | { type: "error"; error: PalError };
```

### 4.1.1 Standardized PAL Error Taxonomy

```typescript
/**
 * Standardized Error Taxonomy for Provider Abstraction Layer
 */
export type PalErrorKind =
  | "rate_limit"       // HTTP 429, RESOURCE_EXHAUSTED -> Pause looper until resetsAt + jitter
  | "overloaded"       // HTTP 503, 529 -> Exponential backoff with full jitter
  | "context_exceeded" // Token limit -> Trigger context compaction / succession
  | "auth_failure"     // HTTP 401, 403 -> Fatal, transition to STATE_ABORTED
  | "content_filter"   // Safety block -> Trigger Auditor / Challenger evaluation
  | "tool_error"       // Tool execution crash -> Return isError: true inside tool_result
  | "invalid_request"  // Malformed payload -> Fatal or retry with sanitized turn
  | "timeout";         // Socket/process hang -> Terminate and restart session

export const PalErrorCodes = {
  RATE_LIMITED: "PAL_RATE_LIMITED",
  CONTEXT_OVERFLOW: "PAL_CONTEXT_OVERFLOW",
  AUTH_ERROR: "PAL_AUTH_ERROR",
  TOOL_FAILED: "PAL_TOOL_FAILED",
  OVERLOADED: "PAL_OVERLOADED",
  TIMEOUT: "PAL_TIMEOUT",
  INVALID_PAYLOAD: "PAL_INVALID_PAYLOAD",
} as const;

export class PalError extends Error {
  constructor(
    public readonly kind: PalErrorKind,
    message: string,
    public readonly retryable: boolean,
    public readonly resetsAt?: number,
    public readonly rawError?: unknown
  ) {
    super(`[${kind}] ${message}`);
    this.name = "PalError";
  }
}
```

### 4.2 Canonical Message & Content Block Data Model

```typescript
/**
 * Canonical PAL Message Model
 */
export interface PalMessage {
  id: string; // UUID v4
  role: "system" | "user" | "assistant" | "tool";
  content: PalContentBlock[];
  name?: string; // Semantic agent sender (e.g. "orchestrator", "worker", "reviewer")
  timestamp: string; // ISO 8601 UTC
  metadata?: Record<string, unknown>;
}

export type PalContentBlock =
  | PalTextContent
  | PalThoughtContent
  | PalToolCallContent
  | PalToolResultContent
  | PalImageContent;

export interface PalTextContent {
  type: "text";
  text: string;
  cacheControl?: { type: "ephemeral" }; // Anthropic prompt caching breakpoint
}

export interface PalThoughtContent {
  type: "thought";
  text: string;
  signature?: string; // Cryptographic verification token (Claude 3.7 / signed models)
  redacted?: boolean; // Redaction flag for out-of-band audit logging
}

export interface PalToolCallContent {
  type: "tool_call";
  id: string; // Globally unique call ID
  name: string;
  arguments: Record<string, unknown>; // Guaranteed parsed JSON
  rawArguments?: string; // Preserved raw payload for debugging
}

export interface PalToolResultContent {
  type: "tool_result";
  toolCallId: string; // Must match corresponding PalToolCallContent.id
  toolName: string;
  content: string | PalContentBlock[];
  isError: boolean;
  durationMs?: number;
}

export interface PalImageContent {
  type: "image";
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string; // Base64 encoded payload
}
```

### 4.3 Bi-directional Turn Normalizers & Invariant Resolution
Each major provider enforces incompatible conversational invariants. The PAL Normalizer reconciles these deterministically:

| Conversational Invariant | Anthropic Claude | Google Gemini / Antigravity | OpenCode / OpenAI / Ollama |
| :--- | :--- | :--- | :--- |
| **System Instruction** | Top-level `system` parameter. **Fatal error** if placed in `messages`. | Top-level `system_instruction` object with `parts: [{ text }]`. | First entry in `messages` with `role: "system"`. |
| **Turn Alternation** | Strictly alternating: `user` $\rightarrow$ `assistant` $\rightarrow$ `user`. Consecutive user messages must be concatenated. | Strictly alternating: `user` $\rightarrow$ `model` $\rightarrow$ `user`. | Relaxed. Multiple consecutive messages of any role permitted. |
| **Tool Invocations** | Embedded in `assistant` message as `{ type: "tool_use", id, name, input }`. | Embedded in `model` message as `parts: [{ function_call: { name, args } }]`. | Embedded in `assistant` message as `tool_calls: [{ id, function: { name, arguments } }]`. |
| **Tool Results** | Wrapped in `user` turn as `{ type: "tool_result", tool_use_id, content }`. | Wrapped in `user` turn as `parts: [{ function_response: { name, response: { content } } }]`. | Dedicated message with `role: "tool"`, `tool_call_id`, and `content`. |
| **Thinking Blocks** | `{ type: "thinking", thinking, signature }` block with token budget. | Part with `thought: true` or dedicated reasoning token counter. | Delta field `reasoning_content` (DeepSeek) or raw `<think>...</think>` regex extraction. |
| **Prompt Caching** | Explicit breakpoints: `cache_control: { type: "ephemeral" }` (max 4 per request). | Automated prefix caching or explicit `cached_contents` API resource. | Server-side KV prefix caching (vLLM / Ollama), transparent to API. |

```typescript
export interface ClaudeTurnPayload {
  system?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: Array<{
    role: "user" | "assistant";
    content: string | Array<
      | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
      | { type: "thinking"; thinking: string; signature?: string }
      | { type: "redacted_thinking"; data: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      | { type: "tool_result"; tool_use_id: string; content: string | Array<{ type: "text"; text: string }>; is_error?: boolean }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    >;
  }>;
}

export interface GeminiTurnPayload {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{
    role: "user" | "model";
    parts: Array<
      | { text: string }
      | { functionCall: { name: string; args: Record<string, unknown> } }
      | { functionResponse: { name: string; response: Record<string, unknown> } }
      | { inlineData: { mimeType: string; data: string } }
    >;
  }>;
}

export interface OpenAiTurnPayload {
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content?: string | null | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  }>;
}

export interface PalTurnNormalizer {
  toClaude(messages: PalMessage[]): ClaudeTurnPayload;
  fromClaude(response: unknown): PalMessage;
  toGemini(messages: PalMessage[]): GeminiTurnPayload;
  fromGemini(response: unknown): PalMessage;
  toOpenAi(messages: PalMessage[]): OpenAiTurnPayload;
  fromOpenAi(response: unknown): PalMessage;
}
```

#### 4.3.1 Turn-Folding Invariant (Claude & Gemini Alternation Enforcement)
Anthropic Claude and Google Gemini APIs mandate strict role alternation (`user` $\leftrightarrow$ `assistant` / `model`). Multi-agent systems, OpenAI adapters, and local tools emit sequences of multiple consecutive `role: "tool"` or `role: "user"` messages.

**Normalizer Invariant Rules**:
1. When generating `ClaudeTurnPayload` or `GeminiTurnPayload`, the normalizer scans the canonical message sequence.
2. Any contiguous sequence of messages where `role === "user"` or `role === "tool"` is folded into a single unified `user` turn.
3. Content blocks from all messages in the run are preserved in sequential order within the single turn.
4. Any contiguous sequence of `assistant` messages is merged into a single `assistant` turn with aggregated content blocks.
5. If the first message in the history is an `assistant` turn, a synthetic empty `user` initialization message (`"Begin session"`) is prepended to satisfy provider requirements.

#### 4.3.2 Atomic Tool Batch Resolution Invariant
Both Claude and Gemini require that if an assistant/model turn outputs $N$ tool calls ($id_1, id_2, \dots, id_N$), the immediately following user turn must return matching tool results for all $N$ invocations.

**Invariant Enforcement**:
1. Before emitting the user turn, PAL audits the tool results against the preceding model turn's tool calls.
2. If any tool call $id_k$ lacks a corresponding tool result (due to execution failure, timeout, cancellation, or crash), PAL automatically synthesizes an error result:
   ```typescript
   {
     type: "tool_result",
     toolCallId: id_k,
     toolName: call_k.name,
     content: "Error: Tool execution aborted, timed out, or unhandled by runner.",
     isError: true
   }
   ```
3. This guarantees that orphaned tool calls never reach provider APIs, preventing HTTP 400 bad request crashes.

#### 4.3.3 Gemini Protobuf Struct Invariant
The Google Gemini Protobuf schema mandates that `function_response.response` must be a valid JSON Object / Map (`google.protobuf.Struct`). Primitive strings or arrays trigger fatal `INVALID_ARGUMENT` rejections.

**Normalizer Transformation Rule in `toGemini()`**:
```typescript
function formatGeminiResponse(content: string | PalContentBlock[], isError: boolean): Record<string, unknown> {
  if (typeof content === "string") {
    return isError ? { error: content } : { output: content };
  }
  if (Array.isArray(content)) {
    return { output: content.map(c => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n") };
  }
  if (typeof content === "object" && content !== null) {
    return content as Record<string, unknown>;
  }
  return { output: String(content) };
}
```
Furthermore, because Gemini matches function responses to calls by position and name rather than ID, `toGemini()` guarantees strict FIFO ordering of `function_response` parts matching the order of `function_call` parts in the preceding turn.

### 4.4 Extended Thinking & Cryptographic Signature Contracts
Modern frontier models (Claude 3.7 Sonnet Thinking, Gemini 2.0 Flash Thinking, DeepSeek R1) emit chain-of-thought traces. In a multi-agent auditing architecture:
1. **Thought Capture**: PAL captures thinking tokens into `PalThoughtContent`.
2. **Cryptographic Signatures**: Claude 3.7 supplies an encrypted signature alongside thinking blocks. The normalizer **must preserve this signature intact**; re-submitting an altered or stripped thinking block to Claude's API results in HTTP 400 rejection.
3. **Audit Visibility**: Auditors and Challengers can inspect `PalThoughtContent` in audit logs to verify reasoning integrity, while the normalizer strips thought blocks when translating to models that do not accept reasoning in history (preventing token inflation).

### 4.5 Unified Tool Definition, MCP Bridge & ReAct Fallback

```typescript
export interface PalToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  source: "native" | "mcp";
  mcpServerName?: string;
  timeoutMs?: number;
}

export type PalToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; toolName: string };

export interface PalToolExecutionContext {
  agentId: string;
  role: CognitiveRole;
  workingDirectory: string;
  abortSignal?: AbortSignal;
  logger: (level: "info" | "warn" | "error", message: string) => void;
}

export type PalToolHandler = (
  args: Record<string, unknown>,
  context: PalToolExecutionContext
) => Promise<string | Record<string, unknown>>;
```

#### 4.5.1 Model Context Protocol (MCP) Bridge
The PAL engine exposes native bidirectional binding to MCP servers. MCP tools (such as GitHub, file system, database, or web search tools) are auto-discovered from configuration, converted into `PalToolDefinition`, and registered with the active provider.

#### 4.5.2 ReAct Fallback Engine & Truncation Watchdog
For models lacking native tool use (open-weights models via Ollama/vLLM):
1. **Permissive Tag Regex**: The stream parser uses a whitespace-tolerant regex:
   ```typescript
   const TOOL_CALL_REGEX = /<tool_call[\s\S]*?>([\s\S]*?)<\/tool_call>/gi;
   ```
2. **String-Boundary Tolerant JSON Parsing**: Code generation tools (`write_to_file`) frequently produce nested double quotes. `JsonAutoRepair` applies boundary heuristics:
   - Strips enclosing markdown code fences (` ```json ... ``` `).
   - Normalizes unescaped internal quotes within string values before invoking `JSON.parse`.
3. **Stream Truncation Watchdog**:
   - If the model output stream terminates (`finish_reason === "length"` or connection close) with an unclosed `<tool_call>` tag (e.g. `<tool_call>{"name": "write_to_file", "arguments": ...` without closing tag):
   - PAL intercepts the event, emits `PAL_TRUNCATED_STREAM`, and issues an automated continuation prompt:
     `[SYSTEM] Your previous JSON tool call was truncated by token limits. Output ONLY the remainder of the JSON starting from the truncation point, ending with </tool_call>.`
   - The stream fragments are stitched together and parsed, avoiding dropped tool calls.

### 4.6 Capability Negotiation Matrix & Leaky-Bucket Rate Limiter

```typescript
export interface PalProviderCapabilities {
  providerName: "claude" | "antigravity" | "opencode";
  modelName: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  supportsNativeTools: boolean;
  supportsStreaming: boolean;
  supportsExtendedThinking: boolean;
  supportsPromptCaching: boolean;
}
```

#### 4.6.1 Mathematical Rate Limiting Model & Concurrency Semaphore
To prevent 429 cascades across concurrent subagents sharing an API key:

1. **Token Bucket Specification**:
   - Bucket Capacity: $C_{\text{tokens}} = \text{TPM}$, $C_{\text{requests}} = \text{RPM}$.
   - Continuous Refill Rate: $r = \frac{C}{60}$ units per second.
   - At timestamp $t$, available units:
     $$B(t) = \min(C, B(t_{\text{last}}) + r \cdot (t - t_{\text{last}}))$$
   - **Pre-reservation**: A turn estimating $E$ tokens may dispatch if and only if $B(t) \ge E$. Upon dispatch, $B(t) \leftarrow B(t) - E$. When the turn completes with actual usage $A < E$, the difference $E - A$ is refunded immediately.

2. **Atomic FIFO Ticket Semaphore**:
   - Subagents request execution slots through a mutex-guarded FIFO queue.
   - Eliminates Check-Then-Act (TOCTOU) race conditions where multiple subagents burst simultaneously against available capacity.

3. **Full-Jitter Exponential Backoff**:
   - For retryable server errors (HTTP 500, 503, 529):
     $$T_{\text{sleep}} = \min(T_{\text{max}}, T_{\text{base}} \cdot 2^{\text{attempt}}) \cdot \text{Uniform}(0.5, 1.5)$$
     where $T_{\text{base}} = 1000\text{ms}$, $T_{\text{max}} = 60000\text{ms}$, $\text{MaxAttempts} = 5$.

4. **Decorrelated Jitter on Reset (Thundering Herd Mitigation)**:
   - When a provider issues HTTP 429 / `RESOURCE_EXHAUSTED` with a reset epoch $t_{\text{reset}}$:
     $$T_{\text{wake}} = t_{\text{reset}} + \text{UniformRandom}(100, 1500)\text{ms}$$
   - Concurrent subagents wake up at staggered intervals, preventing synchronized secondary 429 bursts.

5. **Atomic Context Compaction Invariant**:
   - Triggered at 85% of `maxContextTokens`.
   - Compaction algorithms treat `[assistant(tool_call), user(tool_result)]` turn pairs as an atomic unit. Truncation or summarization boundaries must never sever a tool call from its matching result.

---

## 5. State Persistence, Resilience & Fault Tolerance

### 5.1 File-Based Memory Hierarchy in `.agents/teamwork/`
To guarantee 100% crash recovery without external database dependencies, all operational state is persisted directly on the filesystem:

```
.agents/teamwork/
├── sentinel/
│   ├── BRIEFING.md              # Sentinel working memory (<100 lines)
│   └── progress.md              # Sentinel liveness heartbeat
├── teamwork_preview_orchestrator_1/
│   ├── BRIEFING.md              # Orchestrator memory (team roster, spawn count)
│   ├── DISPATCH.md              # Log of commands received
│   ├── PROJECT.md               # Feature inventory & milestone status
│   └── progress.md              # Orchestrator heartbeat
├── worker_m1_1/
│   ├── BRIEFING.md              # Worker identity, constraints, active task
│   ├── DISPATCH.md              # Worker task instructions
│   ├── handoff.md               # 5-component completion report
│   └── progress.md              # Worker heartbeat
└── challenger_m1_1/
    ├── BRIEFING.md
    └── handoff.md               # Adversarial challenge findings & test scripts
```

#### Memory Invariant Rules:
1. **The 🔒 Append-Only Contract**: `BRIEFING.md` contains protected sections (`## 🔒 My Identity`, `## 🔒 Key Constraints`) that must NEVER be deleted or overwritten during agent turns.
2. **Heartbeat Rule**: Every active agent must touch `progress.md` after every meaningful action and at least every 5 minutes (`Last visited: [timestamp]`).
3. **5-Component Handoff Protocol**: All task handoffs must contain:
   - Section 1: **Observation** (verbatim facts, paths, line numbers, errors).
   - Section 2: **Logic Chain** (step-by-step reasoning from observation to conclusion).
   - Section 3: **Caveats** (assumptions, uninspected areas).
   - Section 4: **Conclusion** (actionable outcome).
   - Section 5: **Verification Method** (reproducible commands to prove claims).

### 5.2 Working Tree Isolation, Git Snapshotting & Atomic Rollback
Implemented via `RollbackStateBuffer` (`resilience.ts`):
1. **Pre-Execution Baseline**: Before dispatching a Worker, the harness captures the exact Git `HEAD` commit SHA and records untracked files:
   ```typescript
   const baselineSha = await git.revParse("HEAD");
   ```
2. **Sandboxed Mutation**: The Worker executes in the repository. Workers are strictly forbidden from running `git commit`, `git reset`, or `git push`.
3. **Atomic Rollback on Gate Rejection**: If a task fails verification attempts:
   ```bash
   # Atomic rollback isolating persistent teamwork memory and project deliverables
   git reset --hard ${baselineSha}
   git clean -fd -e .agents/teamwork/ -e projects/
   ```
   All broken artifacts, syntax errors, and temporary test files are completely eradicated before engaging the escalation ladder.
   - **Configuration Invariant**: `.agents/teamwork/` must be listed in `.gitignore` and `CONSTANTS.NEVER_COMMIT`.
   - **Buffer Invariant**: `resilience.ts:RollbackStateBuffer.rollback()` must execute with `-e .agents/teamwork/ -e projects/` to guarantee that agent memory, briefings, heartbeats, and project deliverables are never wiped.
4. **Certified Commit**: If and only if Gates 0–3 pass, the harness stages changes and creates a signed Conventional Commit:
   ```bash
   git commit -m "feat(looper): [TASK-ID] Implement feature verified by 4-tier gates"
   ```

### 5.3 Context Succession Pattern (The 16-Spawn Rule)
Context degradation causes AI agents to lose focus, hallucinate constraints, and drift from instructions. The Agnostic Looper enforces the **16-Spawn Succession Rule**:
1. The Orchestrator maintains `spawn_count` in its `BRIEFING.md`.
2. When `spawn_count >= 16` or token window utilization reaches 80%:
   - Orchestrator pauses active dispatches.
   - Orchestrator generates a `handoff.md` (Type: Soft) documenting active tasks, completed milestones, and team state.
   - Orchestrator spawns `teamwork_preview_orchestrator_2` (Successor).
   - Successor inherits predecessor folder, reads `handoff.md`, initializes its `BRIEFING.md`, and resumes loop execution seamlessly.

#### Mid-Execution Succession Protection Invariant
Succession transitions (`STATE_SUCCESSION`) are strictly evaluated at safe task boundaries:
1. Primary checks occur in `STATE_PLAN_DECOMPOSE` (before task selection) and `STATE_COMMIT_CHECKPOINT` (after certified commit).
2. If token consumption reaches the critical 80% watermark mid-execution (during `STATE_EXECUTE_WORKER` or verification gates):
   - The active subagent is commanded to perform an immediate soft handoff.
   - The harness captures the uncommitted diff into a temporary stash: `git stash create`.
   - The harness rolls back the working tree to `${baselineSha}` (`git reset --hard ${baselineSha} && git clean -fd -e .agents/teamwork/ -e projects/`).
   - The FSM transitions to `STATE_SUCCESSION`.
   - The successor Orchestrator applies the stashed work and re-dispatches the task cleanly without context truncation.

### 5.4 Idempotent Crash Recovery & Stale Agent Detection
If the looper process is terminated (e.g. system reboot, SIGKILL, power outage):
1. **Dirty Tree Reconciliation**: On startup, the harness inspects Git status. If uncommitted changes exist from an incomplete task attempt, the harness executes `rollbackWorkingTree()` (`git reset --hard && git clean -fd -e .agents/teamwork/ -e projects/`).
2. **Task State Discovery**: The harness parses `tasks.md` / `tasks_catalog.json` and locates the first uncompleted (`- [ ]`) task in topological order.
3. **Watchdog Heartbeat Monitor**: A background cron checks `progress.md` across active agent folders. If an agent's `Last visited` timestamp is older than 15 minutes, the watchdog terminates the process, rolls back the task, and re-dispatches a fresh agent.

---

## 6. Engineering Work Stream Decomposition Matrix

The Agnostic Looper decomposes into four core engineering work streams. Each work stream contains discrete, modular tasks formulated for direct tracking in GitHub Project #4.

```
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
                              ENGINEERING WORK STREAM DECOMPOSITION
═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

  Stream 1: Core Engine & Lifecycle State Machine
  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  [LOOPER-CORE-001]  Finite State Machine (FSM) Lifecycle & Event-Driven Engine
  [LOOPER-CORE-002]  Task Dependency Graph (DAG) Scheduler & Topological Resolver
  [LOOPER-CORE-003]  Cognitive Role Dispatcher & Subagent Sandbox Manager
  [LOOPER-CORE-004]  Autonomous Router & 6-Rung Failure Escalation Pipeline
  [LOOPER-CORE-005]  Context Succession Engine (16-Spawn Orchestrator Succession)

  Stream 2: Provider Abstraction Layer (PAL) & Normalizers
  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  [LOOPER-PAL-001]   Canonical Message Schema, Content Blocks & Turn Normalizer
  [LOOPER-PAL-002]   Anthropic Claude Provider Adapter (Messages API & Claude Code SDK)
  [LOOPER-PAL-003]   Google Gemini / Antigravity Provider Adapter (GenAI & agy CLI)
  [LOOPER-PAL-004]   OpenCode & Local LLM Adapter (Ollama, vLLM, LiteLLM & OpenCode CLI)
  [LOOPER-PAL-005]   Unified Tool & MCP Bridge with ReAct Fallback & JSON Auto-Repair
  [LOOPER-PAL-006]   Capability Negotiation Matrix & Leaky-Bucket Rate Limiter

  Stream 3: Objective 4-Tier Verification Harness & Rollback Buffer
  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  [LOOPER-GATE-001]  Gate 0: Automated Mechanical QA Runner & Trace Formatter
  [LOOPER-GATE-002]  Gate 1: Independent Semantic Code Reviewer Subagent
  [LOOPER-GATE-003]  Gate 2: Adversarial Challenger Red-Team Fuzzing Engine
  [LOOPER-GATE-004]  Gate 3: Forensic Victory Auditor & Invariant Enforcement
  [LOOPER-GATE-005]  Atomic RollbackStateBuffer & Git Baseline Snapshotting

  Stream 4: CLI, State Persistence & GitHub Project #4 Integration
  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  [LOOPER-INT-001]   File-Based Persistent Memory Hierarchy & Heartbeat Watchdogs
  [LOOPER-INT-002]   GitHub Project #4 Integration Service (GraphQL / gh CLI)
  [LOOPER-INT-003]   Local Task Catalog Sync Engine (tasks_catalog.json / md)
  [LOOPER-INT-004]   Structural Validation Harness (verify_project_items.ts / py)
  [LOOPER-INT-005]   Agnostic Looper Unified CLI Entry Point & Telemetry Dashboard
```

### 6.1 Stream 1: Core Engine & Lifecycle State Machine
Focuses on the state transitions, task scheduling, cognitive role dispatching, and dynamic error escalation.
- **Tasks**:
  1. `LOOPER-CORE-001`: Event-Driven FSM with strict transition guards and typed state events.
  2. `LOOPER-CORE-002`: Task DAG Resolver computing topological execution order and tracking completion checkboxes.
  3. `LOOPER-CORE-003`: Role Dispatcher instantiating isolated agent folders under `.agents/teamwork/` with injected skills.
  4. `LOOPER-CORE-004`: Autonomous Router implementing the 6-rung escalation ladder from local retry to Sentinel escalation.
  5. `LOOPER-CORE-005`: Succession Manager tracking spawn counts and executing seamless orchestrator transfers.

### 6.2 Stream 2: Provider Abstraction Layer (PAL) & Normalizers
Focuses on the hexagonal port/adapter architecture isolating the looper from vendor APIs.
- **Tasks**:
  1. `LOOPER-PAL-001`: Canonical data model (`PalMessage`, `PalContentBlock`) and bidirectional turn normalizer.
  2. `LOOPER-PAL-002`: Claude adapter with extended thinking and ephemeral prompt caching.
  3. `LOOPER-PAL-003`: Antigravity/Gemini adapter with 2M token context and NDJSON stream parsing.
  4. `LOOPER-PAL-004`: OpenCode adapter with OpenAI-compatible endpoint support and local vLLM streaming.
  5. `LOOPER-PAL-005`: MCP tool bridge, ReAct fallback parser, and JSON argument repair.
  6. `LOOPER-PAL-006`: Capability matrix, Token Bucket rate limiting, and context overflow compaction.

### 6.3 Stream 3: Objective 4-Tier Verification Harness & Rollback Buffer
Focuses on the multi-gate verification pipeline and atomic rollback engine.
- **Tasks**:
  1. `LOOPER-GATE-001`: Gate 0 test harness (`bun test`, `tsc`, `lint`) with sanitized error tag extraction.
  2. `LOOPER-GATE-002`: Gate 1 Reviewer agent auditing diffs against task acceptance criteria.
  3. `LOOPER-GATE-003`: Gate 2 Adversarial Challenger generating fuzzing probes and breaking unit tests.
  4. `LOOPER-GATE-004`: Gate 3 Forensic Auditor executing binary veto and layout checks.
  5. `LOOPER-GATE-005`: `RollbackStateBuffer` capturing Git baseline SHA and executing hard resets on failure.

### 6.4 Stream 4: CLI, State Persistence & GitHub Project #4 Integration
Focuses on persistence, CLI control, telemetry, and bidirectional synchronization with GitHub Project #4.
- **Tasks**:
  1. `LOOPER-INT-001`: Filesystem memory manager (`BRIEFING.md` 🔒 sections, `progress.md` heartbeats, `handoff.md`).
  2. `LOOPER-INT-002`: GitHub Project #4 mutation client creating items via GraphQL / `gh` CLI.
  3. `LOOPER-INT-003`: Local catalog generator writing `tasks_catalog.json` and `tasks_catalog.md`.
  4. `LOOPER-INT-004`: Programmatic validation script (`verify_project_items.ts`) asserting 100% compliance across all 4 Spanish sections.
  5. `LOOPER-INT-005`: CLI runner (`agnostic-looper run`) with live terminal telemetry and cost accounting.

### 6.5 GitHub Project #4 Governance & Structural Validation Standards
All tasks populated in GitHub Project #4 (`https://github.com/users/sastiam/projects/4`) must strictly adhere to the following non-negotiable structural standard:
1. **Mandatory 4 Spanish Sections**: Every item must contain all four explicit markdown headings:
   - `## 1. Propósito de la tarea`
   - `## 2. Qué se espera lograr`
   - `## 3. Goal de la tarea`
   - `## 4. Criterios de completitud / Definition of Done`
2. **Interactive Checklist**: Section 4 must contain at least one verifiable markdown checkbox (`- [ ]`).
3. **Local Catalog Synchronization**: Every created item must be indexed in `projects/agnostic_looper/tasks_catalog.json` with its GraphQL ID, URL, title, work stream, and section contents.
4. **Automated Audit**: Before declaring milestone completion, the automated validation script (`verify_project_items.ts`) must run and return exit code 0, proving 100% compliance across all items.

---

## 7. Appendix & References

1. **Antigravity Teamwork Documentation**: `https://antigravity.google/docs/teamwork/`
2. **Target Project Board**: `https://github.com/users/sastiam/projects/4` (Project Node ID: `PVT_kwHOA0KY4s4Boie_`)
3. **Repository Base Modules**:
   - `/home/sastiam/Workspace/openspec-cascade/cascade.ts`: Looper execution baseline.
   - `/home/sastiam/Workspace/openspec-cascade/qa.ts`: Gate 0 automated testing infrastructure.
   - `/home/sastiam/Workspace/openspec-cascade/resilience.ts`: `RollbackStateBuffer` & Git snapshotting.
   - `/home/sastiam/Workspace/openspec-cascade/engine.ts`: Core provider adapter interfaces.
   - `/home/sastiam/Workspace/openspec-cascade/claude.ts`: Claude Agent SDK client implementation.
   - `/home/sastiam/Workspace/openspec-cascade/antigravity.ts`: Antigravity CLI NDJSON streaming client.
   - `/home/sastiam/Workspace/openspec-cascade/opencode.ts`: OpenCode CLI execution harness.
4. **Survey Research Deliverables**:
   - Explorer 1 (Multi-Agent Architecture): `.agents/teamwork/explorer_survey_1/handoff.md`
   - Explorer 2 (Provider Abstraction Layer): `.agents/teamwork/explorer_survey_2/handoff.md`
   - Explorer 3 (GitHub Project #4 Environment): `.agents/teamwork/explorer_survey_3/handoff.md`
