# Architectural Research Report: Provider-Agnostic Multi-Agent Looper System (Antigravity Teamwork Inspired)

**Author**: Explorer 1 (Multi-Agent Looper Architecture Researcher)  
**Date**: 2026-10-24T14:26:00Z  
**Target Working Directory**: `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_survey_1`  
**Parent Orchestrator**: `teamwork_preview_orchestrator_1` (Conv ID: `6d20d99d-2183-4d1a-ad2e-afc1d559cde6`)  
**Deliverable Document**: `handoff.md`  

---

## 1. Observation

### 1.1 Existing Single-Agent Looper in `openspec-cascade`
Direct inspection of the repository codebase reveals the baseline execution engine:
1. **Harness as Oracle & Single-Task Sessions**: In `cascade.ts` (lines 406–493), the harness executes tasks one-by-one (`runTask`). For each task, an agent session is invoked. If the task requires verification (`verifyCommands`, lines 407, 451–466), the harness runs the commands locally via `runVerificationPhase` (`qa.ts`). The agent's claim of completion is untrusted; only when checks return exit code `0` is the task marked `- [x]`.
2. **Automated QA & Error Feedback Loop**: In `qa.ts` (lines 106–147), failed checks produce structured feedback injected into subsequent retry attempts:
   ```markdown
   <failure command="..." exit_code="...">
   ### STDERR / STACK TRACE:
   ...
   ### STDOUT:
   ...
   </failure>
   ```
   Retries are capped at `config.maxAttemptsPerTask` (default: 3).
3. **Working Tree State Buffering & Atomic Rollback**: In `resilience.ts` (lines 182–269), `RollbackStateBuffer` snapshots the repository `HEAD` SHA before execution starts (`captureGitState`, lines 76–112). If task attempts are exhausted without passing verification, the harness automatically invokes `git reset --hard` and `git clean -fd` (lines 118–175) to prevent leaving dirty or broken artifacts in the repository.
4. **Engine Abstraction via Ports & Adapters**: In `engine.ts` (lines 48–55), the interface `EngineAdapter` abstracts model execution (`runSession`, `getDefaultModel`, `supportsPlanMeters`, `readUsage`). Adapters exist for Claude SDK (`claude.ts`), OpenCode CLI (`opencode.ts`), and Antigravity CLI (`antigravity.ts`).
5. **Rate-Limiting & Plan Usage Meters**: In `cascade.ts` (lines 252–287) and `antigravity.ts` (lines 19–24, 257–260), rate limits (HTTP 429, `RESOURCE_EXHAUSTED`) trigger pause and sleep cycles (`RATE_LIMIT_SLEEP_MS`, `/usage` polling).

### 1.2 Observed Limitations of the Single-Agent Looper
1. **Monolithic Responsibility**: The single agent in `cascade.ts` must understand requirements, write code, self-test, and format commit messages. When it makes an erroneous architectural assumption, subsequent retries often get stuck in local minima (confirmation bias loop).
2. **Absence of Independent Adversarial Verification**: The verification in `qa.ts` is purely mechanical (running static shell scripts). There is no semantic reviewer, no adversarial challenger to test edge cases, and no forensic auditor to verify that the implementation adheres to global invariants.
3. **Lack of Dynamic Routing**: If a task fails because of an ambiguous specification or dependency mismatch, `cascade.ts` simply retries the same prompt up to 3 times before terminating with `TaskFailureError` (line 492). It cannot route to an Explorer for diagnosis or to a Challenger for stress testing.

### 1.3 Teamwork Multi-Agent Architecture in Practice
Inspection of `.agents/teamwork/` demonstrates the live Teamwork multi-agent architecture:
1. **Role Specialization & Separation of Powers**:
   - `sentinel/BRIEFING.md` (lines 6–17): Sentinel keeps context ultra-light, makes no technical decisions, monitors liveness via crons (task-14, task-16), and requires a mandatory **Victory Audit** before claiming completion.
   - `teamwork_preview_orchestrator_1/BRIEFING.md` (lines 7–46): Orchestrator manages the project plan, decomposes work items, dispatches subagents, handles succession at 16 spawns, and is **strictly prohibited** from writing code or running tests directly (`Key Constraints`, lines 37–40).
   - `explorer_survey_1`, `explorer_survey_2`, `explorer_survey_3`: Specialized read-only researchers that build structured evidence chains and communicate findings via files rather than context bloat.
2. **Communication & Workspace Conventions**:
   - Communication rule: *"Files for content delivery. Messages for coordination."*
   - Workspace isolation: Each agent owns exactly one folder under `.agents/teamwork/<folder>/`. Agents can read any folder, but write only to their own. `.agents/teamwork/` contains only metadata (plans, progress, handoffs), never source code or test files.
3. **Persistent Memory & Situational Awareness**:
   - `BRIEFING.md`: Working memory constrained to <100 lines. Survives context truncations using append-only 🔒 sections (`## 🔒 My Identity`, `## 🔒 Key Constraints`, `## 🔒 My Workflow`).
   - `progress.md`: Liveness heartbeat updated at every meaningful step and at least every 5 minutes (`Last visited: [timestamp]`).
   - `DISPATCH.md`: Append-only immutable log of dispatches received from the parent orchestrator.
4. **Handoff Protocol**:
   - 5-Component Report: Observation, Logic Chain, Caveats, Conclusion, Verification Method.
   - Handoff types: Hard (complete), Soft (transferred/context overflow), Partial (stuck/escalated).

---

## 2. Logic Chain

From the observations above, we deduce the architecture of a next-generation **Autonomous Provider-Agnostic Multi-Agent Looper ("Agnostic Looper")**.

### 2.1 The Need for an Orchestrated Multi-Agent Looper
- *Observation*: Single-agent looping (`cascade.ts`) succeeds on narrowly bounded coding tasks but fails on complex refactorings, architectural changes, or ambiguous specifications due to lack of diverse perspectives and confirmation bias.
- *Inference*: A robust autonomous looper must decouple execution into specialized cognitive roles: Planning/Coordination (Orchestrator), Exploration/Diagnosis (Explorer), Implementation (Worker), Quality Review (Reviewer), Adversarial Testing (Challenger), and Objective Compliance (Forensic Auditor).

### 2.2 Core Engine State Machine & Looper Lifecycle
The Multi-Agent Looper operates as a deterministic, event-driven finite state machine (FSM). 

```
                                  +-----------------------+
                                  |      INITIALIZING     |
                                  +-----------+-----------+
                                              |
                                              v
                                  +-----------------------+
                     +----------->|   PLAN_&_DECOMPOSE    |<----------+
                     |            +-----------+-----------+           |
                     |                        |                       |
                     |                        v                       |
                     |            +-----------------------+           |
                     |            |    DISPATCH_WORKER    |           |
                     |            +-----------+-----------+           |
                     |                        |                       |
                     |                        v                       |
                     |            +-----------------------+           |
                     |            |    EXECUTE_WORKER     |           |
                     |            +-----------+-----------+           |
                     |                        |                       |
                     |                        v                       |
                     |            +-----------------------+           |
                     |            | GATE_0: AUTO_CHECKS   |           |
                     |            +-----+-----------+-----+           |
                     |           PASS   |           | FAIL            |
                     |                  v           v                 |
                     |     +--------------+   +--------------+        |
                     |     | GATE_1:      |   | RETRY /      |        |
                     |     | CODE_REVIEW  |   | DIAGNOSE     |--------+ (Exhausted -> Rollback)
                     |     +------+-------+   +--------------+        |
                     |     PASS   |           FAIL                    |
                     |            v           +-----------------------+
                     |     +--------------+
                     |     | GATE_2:      |
                     |     | CHALLENGER   |
                     |     +------+-------+
                     |     PASS   |           FAIL
                     |            v           +-----------------------+
                     |     +--------------+
                     |     | GATE_3:      |
                     |     | FORENSIC_VETO|
                     |     +------+-------+
                     |     PASS   |           FAIL
                     |            v           +-----------------------+
                     |     +--------------+
                     |     | COMMIT &     |
                     |     | CHECKPOINT   |
                     |     +------+-------+
                     |            |
                     |            v
                     |     +--------------+
                     +-----+ MORE TASKS?  |
                      YES  +------+-------+
                                  | NO
                                  v
                           +--------------+
                           | VICTORY_AUDIT|
                           +------+-------+
                                  | PASS
                                  v
                           +--------------+
                           |  COMPLETED   |
                           +--------------+
```

#### Detailed State Definitions:
1. `STATE_INIT`: Harness validates environment, loads configuration, resolves target repository, verifies clean working tree, and checks provider authentication (Claude, Antigravity, OpenCode).
2. `STATE_PLAN_DECOMPOSE`: Orchestrator parses `tasks.md` / `PROJECT.md`, computes task dependency graph (DAG), identifies next actionable task, snapshots baseline git SHA (`RollbackStateBuffer`).
3. `STATE_DISPATCH_WORKER`: Orchestrator initializes worker agent folder (`.agents/teamwork/worker_<id>`), prepares contextual prompt (task description, discovered in-repo skills, project directives, specific verification criteria), and launches Worker.
4. `STATE_EXECUTE_WORKER`: Worker executes changes in the repository. Worker cannot touch Git commands, cannot push, cannot mark tasks done without passing gates.
5. `STATE_GATE_0_AUTO_CHECKS`: Harness automatically executes local deterministic tests (`qa.ts`: bun test, tsc, lint). If non-zero exit code, error traces are formatted into `<verification-feedback>` and routed back to Worker.
6. `STATE_GATE_1_REVIEW`: Independent Reviewer subagent inspects `git diff` against acceptance criteria, checks coding standards, architectural guidelines, and verifies that handoff claims are physically true.
7. `STATE_GATE_2_CHALLENGE`: Adversarial Challenger subagent attempts to break the implementation. It generates adversarial unit tests, edge-case probes, boundary condition checks, and validates error handling.
8. `STATE_GATE_3_FORENSIC_AUDIT`: Independent Auditor subagent executes comprehensive regression suites, checks invariant compliance, verifies file layout rules, and holds a binary veto.
9. `STATE_COMMIT_CHECKPOINT`: If all 4 gates pass, harness commits changes using Conventional Commits (`cascade.ts` line 392), updates `tasks.md` checkbox (`- [x]`), updates `tasks_catalog.json`, and records checkpoint SHA.
10. `STATE_ROLLBACK_RECOVERY`: If verification fails repeatedly and reaches maximum attempt budget, harness triggers `RollbackStateBuffer.rollback()`, cleans untracked files, and moves to the escalation ladder.
11. `STATE_SUCCESSION`: Orchestrator monitors subagent spawn count and context tokens. At spawn limit (e.g. 16 spawns) or 80% context window, Orchestrator writes `handoff.md`, spawns Successor Orchestrator, and yields control without losing state.
12. `STATE_VICTORY_AUDIT`: Once all tasks are complete, Sentinel spawns a final independent Victory Auditor. If passed, the cascade successfully concludes.

---

### 2.3 Autonomous Routing & Role Transitions

#### 2.3.1 Cognitive Role Specialization Matrix

| Role | Primary Responsibility | Permissions | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| **Sentinel** | High-level guardian, liveness monitor, user relay | Read metadata, spawn victory auditor | User prompts, cron timers | Escalations, victory sign-off |
| **Orchestrator** | Task graph planning, subagent lifecycle, succession | Write orchestrator folder, spawn subagents | `PROJECT.md`, `tasks.md`, handoffs | Dispatch manifests, updated plans |
| **Explorer** | Read-only investigation, codebase mapping, diff proposal | Read all, write own folder, no code edit | Dispatch instructions, codebase | 5-component `handoff.md`, patch files |
| **Worker** | Code implementation, local refactoring, build/test execution | Write workspace code, run tests, no git commit | Task instructions, skills, directives | Working tree changes, test results |
| **Reviewer** | Structural review, spec compliance, quality audit | Read workspace, write review report | Working tree diff, task requirements | Review verdict (`APPROVED` / `REJECTED`) |
| **Challenger** | Adversarial testing, edge case probing, fuzzing | Read workspace, add test cases | Implemented code, threat model | Challenge verdict + breaking test cases |
| **Auditor** | Independent binary veto, compliance script verification | Run verification scripts, inspect invariants | Full project state, acceptance criteria | Binary verdict (`PASS` / `FAIL`) |
| **Successor** | Context continuation agent for long-running workflows | Same as Orchestrator or Worker | Predecessor `BRIEFING.md` + `handoff.md` | Continued execution stream |

#### 2.3.2 Autonomous Routing Decision Engine
The looper uses a heuristic-driven Autonomous Router to direct execution without human input:
- **Routing Rule 1 (Task Type)**:
  - If task description contains `"explore"`, `"survey"`, `"investigate"`, `"design"` -> Route to `Explorer`.
  - If task description contains `"implement"`, `"create"`, `"fix"`, `"refactor"`, `"add"` -> Route to `Worker`.
  - If task description contains `"review"`, `"verify"`, `"audit"` -> Route to `Reviewer` + `Auditor`.
- **Routing Rule 2 (Failure Triage & Escalation Ladder)**:
  - **Rung 1 (Local Feedback)**: On first automated check failure (Gate 0), re-invoke Worker with stdout/stderr traces (`maxAttempts = 3`).
  - **Rung 2 (Adversarial Probe)**: If Gate 1 (Reviewer) finds subtle logic bugs or incomplete specifications, dispatch Challenger to synthesize a concrete reproduction script, then feed the failing reproduction script to the Worker.
  - **Rung 3 (Explorer Deep Dive)**: If Worker fails 2 consecutive attempts with architectural or compilation confusion, dispatch an `Explorer` to perform read-only root cause analysis and produce a minimal `.patch` proposal.
  - **Rung 4 (Worker Replacement)**: If Worker fails all 3 attempts, execute atomic git rollback to baseline SHA (`resilience.ts`), kill Worker, and spawn a fresh Worker with the Explorer's diagnosis and patch plan as initial context.
  - **Rung 5 (Orchestrator Task Decomposition)**: If replacement Worker also fails, Orchestrator catches `TaskFailureError`, marks task as compound, and splits the task into smaller sub-tasks.
  - **Rung 6 (Sentinel Escalation)**: Only if fundamental ambiguity, conflicting requirements, or missing external credentials occurs, mark task as `BLOCKED: <reason>` and escalate to Sentinel for user notification.

---

### 2.4 Objective Verification Loops: The 4-Tier Gate Architecture

The core tenet of the looper is: **The harness and independent gates are the oracle; the executing agent's word is never accepted as truth.**

```
   [Worker Output]
          |
          v
  +---------------+
  |    GATE 0     | --> Static & Mechanical Checks (tsc, lint, bun test)
  +-------+-------+     Fast feedback (<30s). Exit code 0 required.
          | Pass
          v
  +---------------+
  |    GATE 1     | --> Semantic Reviewer Agent
  +-------+-------+     Spec fidelity, architectural alignment, clean code.
          | Pass
          v
  +---------------+
  |    GATE 2     | --> Adversarial Challenger Agent
  +-------+-------+     Red-team edge cases, inject unexpected inputs, race conditions.
          | Pass
          v
  +---------------+
  |    GATE 3     | --> Forensic Victory Auditor
  +-------+-------+     Independent script execution, global invariants, binary veto.
          | Pass
          v
     [COMMIT & COMMIT_SUBJECT]
```

1. **Gate 0: Automated Oracle Verification (`qa.ts`)**
   - Deterministic execution of command suite (`tsc --noEmit`, `bun test`, `eslint`, `build`).
   - Captures stdout/stderr, strips noise, truncates to tail traces, formats structured error tags.
2. **Gate 1: Independent Reviewer Agent**
   - Distinct agent session spawned with read-only permissions.
   - Evaluates:
     - Did the worker modify files outside the authorized scope?
     - Are there anti-patterns, missing types, or undocumented side effects?
     - Does the change satisfy the task's stated goal?
3. **Gate 2: Adversarial Challenger Agent**
   - Spawned with explicit objective: *"Find a flaw that breaks this implementation."*
   - Generates property-based test cases, extreme inputs (null, empty, boundary integers, unicode, concurrent calls).
   - If Challenger discovers a crash or unexpected behavior, the task fails verification, and the breaking test is passed back to the Worker as an automated check.
4. **Gate 3: Forensic Auditor (Binary Veto)**
   - Strict pass/fail verdict. No partial credit.
   - Executes verification scripts independently.
   - Checks layout compliance (e.g. source files not written into `.agents/teamwork/`).
   - If Auditor issues a `VETO`, the working tree is rolled back, and the task returns to planning.

---

### 2.5 State Persistence, Memory & Crash Recovery

#### 2.5.1 The File-Based Persistent Memory Hierarchy
To achieve 24/7 autonomous reliability across process crashes, container restarts, and network drops, the looper avoids ephemeral in-memory state or external database dependencies. State is persisted purely on the filesystem:

1. **Episodic & Task State**:
   - `tasks.md` / `PROJECT.md`: Source of truth for task progress. Checkboxes (`- [ ]` vs `- [x]`) indicate completion.
   - Git Commit Tree: Commit history provides permanent immutable snapshots of verified states.
   - `tasks_catalog.json`: Machine-readable index of tasks, IDs, status, commit SHAs, and verification logs.
2. **Agent Working Memory (`BRIEFING.md`)**:
   - Maintained by each agent in `.agents/teamwork/<agent_id>/BRIEFING.md`.
   - Length constrained to <100 lines (index, not a log).
   - Contains append-only 🔒 sections that survive context truncation:
     - `## 🔒 My Identity`
     - `## 🔒 Key Constraints`
     - `## 🔒 My Workflow`
3. **Liveness & Heartbeat Telemetry (`progress.md`)**:
   - Updated after each meaningful action and every 5 minutes.
   - Includes `Last visited: [timestamp]` header.
   - Monitored by Orchestrator/Sentinel liveness crons to detect hangs or zombie processes.
4. **Context Transmission Artifacts (`handoff.md`)**:
   - Written upon task completion, transfer, or escalation.
   - Follows the 5-component protocol: Observation, Logic Chain, Caveats, Conclusion, Verification Method.
5. **Immutable Event Audit Trail (`DISPATCH.md` & `logs/*.jsonl`)**:
   - Every dispatch received is appended with a UTC timestamp header.
   - Stream events, token usages, and tool calls are logged to append-only JSONL files (`cascade.ts` line 113).

#### 2.5.2 Idempotent Crash Recovery Workflow
If the looper process is interrupted (e.g. killed by OS, machine rebooted, power lost):
1. **Startup Discovery**: Upon restart (`bun run cascade.ts`), the harness inspects git status and reads `tasks.md`.
2. **Dirty Tree Reconciliation**:
   - If git working tree is dirty, harness compares working tree with the last recorded checkpoint in `RollbackStateBuffer`.
   - If uncommitted changes belong to an unverified task attempt, the harness automatically executes `rollbackWorkingTree()`.
3. **Resume at First Unchecked Task**: The harness locates the first `- [ ]` task in `tasks.md` and resumes execution with a clean working tree.
4. **Agent Succession on Restart**: Active agent directories under `.agents/teamwork/` with stale timestamps (>15 minutes) are marked abandoned, and fresh subagents are spawned with predecessor handoffs.

---

### 2.6 Fault Tolerance, Liveness & Context Succession

#### 2.6.1 Stale Agent Detection & Heartbeat Watchdogs
- Orchestrator and Sentinel register periodic cron jobs using the `schedule` tool (e.g. `CronExpression="*/5 * * * *"`).
- Heartbeat loop:
  1. Inspect `progress.md` of all active subagents.
  2. Parse `Last visited: <timestamp>`.
  3. If elapsed time > 10 minutes and no tool calls are pending, send high-priority liveness nudge.
  4. If elapsed time > 15 minutes without response, kill subagent task ID via `manage_task(Action="kill")`, mark status as `dead`, trigger git rollback, and re-dispatch.

#### 2.6.2 Context Succession Protocol (The 16-Spawn Rule)
- Problem: As an Orchestrator or long-running worker accumulates tool outputs and subagent messages, context window degradation leads to hallucination, forgetting constraints, and instruction drift.
- Solution: The 16-Spawn Succession Pattern:
  1. Orchestrator maintains `spawn_count` in its `BRIEFING.md`.
  2. When `spawn_count >= 16` (or token usage reaches 80% of window limit):
     - Orchestrator concludes active subagent tasks.
     - Orchestrator writes a comprehensive `handoff.md` (type: Soft) in its folder summarizing current milestone state, pending work items, and team roster.
     - Orchestrator kills its active timers.
     - Orchestrator spawns a `Successor` orchestrator (`teamwork_preview_orchestrator_2`), passing predecessor working directory.
     - Successor initializes its `BRIEFING.md`, inherits 🔒 identity and constraints, and continues seamless execution.

#### 2.6.3 Provider Resilience & Rate-Limit Handling
- **Transient Network & 429 Errors**:
  - Captured via regex in engine adapters (`RATE_LIMIT`, `antigravity.ts` line 21).
  - Triggers exponential backoff or sleeps until meter resets (`waitForUsageHeadroom`, `cascade.ts` line 275).
- **Unrecoverable Failures**:
  - Authentication failure, missing binary, or deleted model alias (`UNRECOVERABLE`, line 23) halts execution cleanly without burning retry tokens.
- **Provider Failover (Heterogeneous Fallback)**:
  - If a primary provider (e.g. Claude) experiences extended downtime or regional exhaustion, Orchestrator can dynamically reroute worker tasks to an alternative provider (e.g. Antigravity Gemini 1.5 Pro or OpenCode DeepSeek V3) by specifying the engine adapter in `EngineSessionOptions`.

---

## 3. Caveats

1. **Provider Tooling Disparities**:
   - While Claude Agent SDK and Antigravity CLI support native tool-calling protocols with structured schemas, OpenCode CLI or local model endpoints (e.g. Ollama/vLLM) vary significantly in tool calling fidelity. The looper's Provider Abstraction Layer (PAL) must normalize tool schemas and sanitize inputs.
2. **Adversarial Challenger Overhead**:
   - Adding Gate 1 (Reviewer), Gate 2 (Challenger), and Gate 3 (Auditor) increases token usage and wall-clock time per task by approximately 2.5x–3.5x compared to single-agent execution. For trivial tasks (e.g. doc formatting), the orchestrator should support dynamic gate tiers (e.g. Fast Track: Gate 0 only; Full Gate: Gates 0–3).
3. **Git Lock Contention**:
   - While multiple Explorers can run in parallel (as they are strictly read-only), Workers that modify the filesystem must execute sequentially or within strictly partitioned directories to avoid git index lock contention or merge collisions.
4. **External Web Access Restrictions**:
   - Real-world environments may enforce sandbox network boundaries (as observed when querying `antigravity.google`). The looper must remain completely self-contained, relying on local filesystem artifacts, repository directives, and ambient CLI tools.

---

## 4. Conclusion

The Multi-Agent Looper architecture synthesizes the best principles of Antigravity Teamwork with the proven execution primitives of `openspec-cascade`. 

### Key Architectural Takeaways for Implementation:
1. **Core Engine Modularization**:
   - Retain and elevate `RollbackStateBuffer` (`resilience.ts`) and `runVerificationPhase` (`qa.ts`) as foundational Gate 0 infrastructure.
   - Introduce an asynchronous Event-Driven State Machine orchestrating role transitions (`Orchestrator`, `Explorer`, `Worker`, `Reviewer`, `Challenger`, `Auditor`).
2. **Separation of Cognitive Concerns**:
   - Workers modify code; Harness and independent Gates verify code; Harness commits code.
   - Binary veto power for Forensic Auditors ensures no hallucinated claims enter git history.
3. **Autonomous Routing & Self-Healing**:
   - The 6-rung escalation ladder prevents endless failure loops by deploying diagnostic Explorers and spawning fresh Workers with clean git rollbacks.
4. **Crash-Proof State Persistence**:
   - File-based persistence (`BRIEFING.md` with 🔒 append-only blocks, `progress.md` heartbeats, `tasks.md`, `tasks_catalog.json`) ensures 100% resumeability without external databases.
5. **Actionable Task Decomposition for Phase 2**:
   The looper system decomposes cleanly into 4 core engineering work streams:
   - **Stream 1**: Looper Core Engine & State Machine (FSM, task DAG scheduler, Ralph loop, role dispatch).
   - **Stream 2**: Verification Harness & Objective Multi-Gate System (Gate 0 automated checks, Gate 1 Reviewer, Gate 2 Adversarial Challenger, Gate 3 Forensic Auditor, Git Rollback State Buffer).
   - **Stream 3**: Memory, Persistence & Resilience Layer (BRIEFING situational awareness, progress heartbeat watchdog, crash recovery, 16-spawn succession protocol).
   - **Stream 4**: Autonomous Routing & Escalation Ladder (Heuristic router, error triage, diagnostic explorer dispatch, worker replacement pipeline).

---

## 5. Verification Method

To independently verify the facts, observations, and code structures reported in this document:

1. **Verify Existing Harness Code & Verification Primitives**:
   - Inspect `cascade.ts` lines 406–493 to verify the single-task execution loop, check execution, and rollback call:
     ```bash
     bun run -e 'import { parseTasks } from "./cascade"; console.log("cascade loaded successfully");'
     ```
   - Run existing unit test suite to confirm QA and resilience modules pass:
     ```bash
     bun test qa.test.ts resilience.test.ts engine.test.ts
     ```
2. **Verify Antigravity Engine Adapter Implementation**:
   - Inspect `antigravity.ts` to verify streaming event parsing, token accounting, and process spawning:
     ```bash
     bun test antigravity.test.ts
     ```
3. **Verify Teamwork Metadata & Workspace Structure**:
   - Verify that all active agent directories contain only metadata (`BRIEFING.md`, `DISPATCH.md`, `progress.md`) and zero source code:
     ```bash
     ls -la .agents/teamwork/sentinel .agents/teamwork/teamwork_preview_orchestrator_1 .agents/teamwork/explorer_survey_1
     ```
4. **Invalidation Conditions**:
   - If an agent other than the harness is given permission to execute `git commit` or `git reset`, the Oracle principle is invalidated.
   - If verification relies solely on LLM self-assessment without deterministic check execution or adversarial testing, the objective verification loop is compromised.
   - If agent working memory does not preserve 🔒 append-only sections across context truncations, the state persistence model fails.
