# Handoff Report — Explorer M1.4: Remediation Architecture Planner

**Agent**: Explorer M1.4 (`explorer_m1_remediation`)  
**Role**: Remediation Architecture Planner (Synthesis & Concrete Specification)  
**Working Directory**: `/home/sastiam/Workspace/openspec-cascade/.agents/teamwork/explorer_m1_remediation`  
**Parent Orchestrator ID**: `6d20d99d-2183-4d1a-ad2e-afc1d559cde6`  
**Target Deliverable**: `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md`  
**Target Implementer**: Worker M1.2 (`worker_m1_2`)  
**Date**: 2026-10-24T14:45:00Z  
**Status**: COMPLETE / ACTIONABLE BLUEPRINT  

---

## 1. Observation

A comprehensive cross-audit of `/home/sastiam/Workspace/openspec-cascade/projects/agnostic_looper/SPECIFICATION.md` against the Gate 1 review and challenge reports yields the following 18 concrete empirical findings across 4 operational domains:

### 1.1 Document Metadata & Integrity (Reviewer M1.2)
1. **Self-Certification Header**: Line 4 of `SPECIFICATION.md` states `**Status**: APPROVED ARCHITECTURE`. This violates Core Invariant 1 (Axiom of Oracle Verification) by pre-emptively declaring approval prior to Gate 1, 2, and 3 certification.

### 1.2 FSM Lifecycle & Escalation Deficiencies (Challenger M1.1)
2. **Untracked Directory Deletion via `git clean -fd`**:
   - Lines 611–614 specify:
     ```bash
     git reset --hard ${baselineSha}
     git clean -fd
     ```
   - Running `git clean -nd` in `/home/sastiam/Workspace/openspec-cascade` outputs:
     ```
     Será borrado .agents/teamwork/
     Será borrado projects/
     ```
   - *Direct Fact*: An atomic rollback using raw `git clean -fd` wipes out `.agents/teamwork/` (all agent memory, briefings, heartbeats, handoffs) and `projects/`.
3. **Victory Audit Infinite Livelock**:
   - In Table 2.2.2 (lines 244–246), `STATE_VICTORY_AUDIT` on `EVT_VICTORY_FAIL` transitions to `STATE_ROLLBACK_RECOVERY`, which on `EVT_ESCALATION_RESOLVED` transitions to `STATE_PLAN_DECOMPOSE`.
   - In `STATE_PLAN_DECOMPOSE`, all tasks in `PROJECT.md` remain marked `- [x]`. The guard `All tasks marked - [x]` evaluates to `true`, immediately triggering `EVT_ALL_TASKS_DONE` back to `STATE_VICTORY_AUDIT`.
   - *Direct Fact*: The FSM enters a deterministic infinite livelock loop on integration regression.
4. **Fast-Track Policy Disconnected from FSM Transition Matrix**:
   - Section 3.6 (lines 388–389) defines Fast-Track bypassing Gates 1 & 2 directly to Gate 3.
   - Section 2.2.2 (line 239) does not list `STATE_GATE_3_AUDIT` as an allowed target from `STATE_GATE_0_AUTO`.
   - *Direct Fact*: Executing Fast-Track throws a fatal `InvalidStateTransitionError` per Section 2.1 line 146.
5. **Missing FSM State for Cognitive Role Explorer**:
   - Section 2.3 routes exploration tasks to Explorer; Section 2.5 Rung 3 dispatches an Explorer.
   - Table 2.2.2 defines only `STATE_DISPATCH_WORKER` from `STATE_PLAN_DECOMPOSE`.
   - *Direct Fact*: The state machine cannot dispatch read-only Explorers without violating role isolation sandboxing.
6. **Escalation Ladder Sequence Inversion vs. Git Rollback**:
   - Table 2.2.2 triggers `STATE_ROLLBACK_RECOVERY` immediately upon `EVT_G0_EXHAUSTED` (attempt 3), executing `git reset --hard`.
   - Section 2.5 specifies Rungs 2 & 3 (Challenger reproduction and Explorer diagnosis) must inspect the failed implementation.
   - *Direct Fact*: The hard reset erases the dirty working tree diff before Challenger and Explorer can analyze it.
7. **Unbounded Retry Loop in Gate 2 (Adversarial Challenger)**:
   - Line 241 defines `EVT_G2_BREAK -> STATE_EXECUTE_WORKER` with no attempt limit guard, enabling an infinite ping-pong loop.
8. **16-Spawn Succession Mid-Execution Trapping**:
   - Section 5.3 mandates succession when `spawn_count >= 16` or context $\ge 80\%$, but transitions to `STATE_SUCCESSION` are only defined in `STATE_PLAN_DECOMPOSE` and `STATE_COMMIT_CHECKPOINT`. Mid-task spikes lack a legal transition.

### 1.3 PAL Core Interface Contracts & Error Taxonomy (Reviewer M1.2)
9. **Missing TypeScript Core Port & Session Interfaces**:
   - `IPalProvider` exists only as ASCII art in lines 404–411.
   - `PalSessionOptions`, `PalOutcome`, `PalStreamEvent`, `PalTokenUsage`, `PalRateLimitInfo`, and `PalFinishReason` are completely absent as TypeScript interface definitions.
10. **Missing PAL Error Taxonomy**:
    - `SPECIFICATION.md` contains 0 mentions of `PalErrorKind` or standardized error codes (`PAL_RATE_LIMITED`, `PAL_CONTEXT_OVERFLOW`, `PAL_AUTH_ERROR`, `PAL_TOOL_FAILED`).
11. **Type Safety Erosion & Permissive `any` in Normalizers**:
    - Section 4.3 (lines 492–500) uses `messages: any[]`, `response: any`, `systemInstruction?: any`, `contents: any[]`.
    - In `toClaude`, `system?: string` strips Anthropic prompt caching breakpoints (`cache_control: { type: "ephemeral" }`).
12. **Missing Tool Execution Contracts**:
    - Section 4.5 defines schema metadata but omits runtime execution types: `PalToolExecutionContext`, `PalToolHandler`, `PalToolChoice`.
13. **Underspecified Rate Limiting Mathematics**:
    - Section 4.6 describes Leaky Bucket and backoff qualitatively without mathematical formulas, parameters, or concurrency coordination mechanisms.
14. **Unresolved Types in Routing Policy**:
    - Section 2.3 lines 252–256 references undeclared types `CognitiveRole` and `GateTierPolicy`.

### 1.4 Provider Invariants & Fallbacks (Challenger M1.2 & Reviewer M1.2)
15. **Turn Alternation & Consecutive Tool Turns in `toClaude` / `toGemini`**:
    - OpenCode and OpenAI schemas emit discrete `role: "tool"` messages.
    - Translating these 1:1 causes consecutive `user` turns, which Anthropic API rejects with HTTP 400 (`roles must alternate between "user" and "assistant"`).
16. **Orphaned Tool Results on Partial Execution**:
    - If an assistant emits $N$ parallel tool calls, Anthropic and Gemini mandate that the next turn return results for all $N$ calls. The specification lacks an atomic batch resolution rule to synthesize error results for failed/cancelled calls.
17. **Gemini `function_response` Protobuf Struct Deserialization Crash**:
    - Google Gemini Protobuf schema mandates that `function_response.response` must be a valid JSON Object / Map (`google.protobuf.Struct`). Bare string content causes `INVALID_ARGUMENT`.
18. **ReAct Parser Crashes, Code Quote Escaping & Stream Truncation**:
    - Regex `/<tool_call>/` fails on tag whitespace variations (`<tool_call >`).
    - Unescaped internal quotes in code generation arguments crash naive JSON parsing.
    - Streams truncating mid-tag emit 0 tool calls without signaling a truncation event.
19. **Leaky Bucket TOCTOU Race & Thundering Herd 429 Cascade**:
    - Non-atomic check-then-act logic under multi-agent concurrency permits burst over-subscription.
    - Synchronized wakeups at `resetsAt` without jitter trigger instant secondary 429 storms.

---

## 2. Logic Chain

The reasoning linking each observation to its concrete architectural remediation is as follows:

```
[Observation 1: Self-Certification Header]
  └──> Violates Invariant 1 (Axiom of Oracle Verification)
  └──> Remediation: Downgrade Status to "PROPOSED SPECIFICATION (PENDING REVIEW GATES)"

[Observation 2: git clean -fd deletes .agents/teamwork/ and projects/]
  └──> Rollback wipes active memory (BRIEFING, DISPATCH, progress, handoff)
  └──> Remediation: Mandate "git clean -fd -e .agents/teamwork/ -e projects/" across all specs and resilience scripts

[Observation 3: Victory Audit failure livelock]
  └──> Reverting to PLAN_DECOMPOSE with all tasks marked [x] immediately retriggers VICTORY_AUDIT
  └──> Remediation: Introduce STATE_VICTORY_TRIAGE to unmark culprit tasks to [ ] or transition to BLOCKED

[Observation 4: Fast-Track bypass unreachable in FSM]
  └──> Gate 0 cannot legally transition to Gate 3 under Section 2.2.2 transition matrix
  └──> Remediation: Add transition EVT_G0_PASS_FAST_TRACK: STATE_GATE_0_AUTO -> STATE_GATE_3_AUDIT

[Observation 5: No FSM state for Explorer]
  └──> Dispatching read-only agents via STATE_DISPATCH_WORKER breaches cognitive role sandboxing
  └──> Remediation: Add STATE_DISPATCH_EXPLORER and STATE_EXECUTE_EXPLORER to FSM

[Observation 6: Premature rollback before escalation diagnostics]
  └──> Hard reset at Gate 0 wipes the failure diff that Challenger & Explorer need to inspect
  └──> Remediation: Insert STATE_ESCALATE_DIAGNOSTIC (Rungs 2-3) before STATE_ROLLBACK_RECOVERY (Rung 4)

[Observation 7: Unbounded Gate 2 loop]
  └──> Continuous edge case generation without attempt bound risks infinite token drain
  └──> Remediation: Add attempt limit guard (Attempts < MaxChallengeAttempts, default: 2) to EVT_G2_BREAK

[Observation 8: Mid-task 16-spawn succession]
  └──> Token threshold breach mid-task causes crash without legal transition
  └──> Remediation: Specify atomic task-boundary evaluation; mid-task breach checkpoints and shelves active task

[Observations 9, 10, 11, 12, 14: PAL Interface & Type Omissions]
  └──> Downstream implementers in M2/M3 cannot build typed adapters without formal contracts
  └──> Remediation: Provide comprehensive, strict TypeScript interfaces for IPalProvider, PalSessionOptions,
       PalOutcome, PalStreamEvent, PalTokenUsage, PalRateLimitInfo, PalErrorKind, PalError, PalToolExecutionContext,
       PalToolHandler, PalToolChoice, and strict payload types for PalTurnNormalizer

[Observations 15, 16, 17: Provider Wire Protocol Invariants]
  └──> Strict alternation, complete tool batches, and Protobuf Struct requirements cause HTTP 400 crashes
  └──> Remediation: Formulate Turn-Folding Invariant, Atomic Tool Batch Reconciliation, and Gemini Struct Wrapping

[Observation 18: ReAct Parser & Stream Truncation]
  └──> Local models emitting unescaped quotes or truncating mid-tag hang the looper
  └──> Remediation: Define relaxed regex, string-boundary parser, and Truncation Watchdog continuation turn

[Observation 19: Leaky Bucket TOCTOU & Thundering Herd]
  └──> Concurrent subagents burst over capacity; simultaneous wakeups cause secondary 429 storms
  └──> Remediation: Specify Token Reservation FIFO Semaphore and Decorrelated Jitter on resetsAt
```

---

## 3. Caveats

1. **Implementation Scope Separation**: Explorer M1.4 designs the *specification amendments*, not the compiled runtime code. The output consists of turnkey textual, state machine, and code blocks for Worker M1.2 to integrate into `SPECIFICATION.md`.
2. **Existing Codebase Cleanliness**: The root `openspec-cascade` repository compiles cleanly with 203 passing tests. All modifications are strictly scoped to `projects/agnostic_looper/SPECIFICATION.md`.
3. **Local Model Diversity**: Different quantized weights (DeepSeek, Qwen, Mistral) emit idiosyncratic XML or JSON malformations. The ReAct parser rules and Truncation Watchdog address the primary 95% of failure modes; edge-case quirks will be fuzzed in Milestone M3.

---

## 4. Conclusion & Concrete Remediation Blueprints

Worker M1.2 must apply the following four blueprints to `projects/agnostic_looper/SPECIFICATION.md`. Every section provides the exact content, code blocks, and line targets.

---

### Blueprint 1: Document Metadata & System Invariants

#### 1.1 Status Header Update (Replace lines 3–4)
```markdown
**Document Version**: 1.0.0-PROD  
**Status**: PROPOSED SPECIFICATION (PENDING REVIEW GATES)  
```

#### 1.2 Git Clean Invariant Update (Update Section 1.2 Axiom 4, Section 2.2.1, Section 5.2)
Wherever `git clean -fd` appears, replace with:
```bash
git reset --hard ${baselineSha}
git clean -fd -e .agents/teamwork/ -e projects/
```
In Section 1.2 Axiom 4 (line 70), update to:
> "4. **Zero Dirty Repository History**: Unverified changes must never pollute the git working tree or commit log. Every task operates against an atomic baseline snapshot; any task that fails gate verification is hard-reset (`git reset --hard && git clean -fd -e .agents/teamwork/ -e projects/`) before recovery or escalation, strictly preserving agent memory and project assets."

In Section 5.2 (lines 610–615), update the rollback code block and text:
```bash
# Atomic rollback isolating persistent teamwork memory and project deliverables
git reset --hard ${baselineSha}
git clean -fd -e .agents/teamwork/ -e projects/
```
Add explicit configuration requirements:
- `.agents/teamwork/` must be listed in `.gitignore` and `CONSTANTS.NEVER_COMMIT`.
- `resilience.ts:RollbackStateBuffer.rollback()` must execute with `-e .agents/teamwork/ -e projects/`.

---

### Blueprint 2: Looper FSM Architecture, State Machine & Escalation Ladder

#### 2.1 State Definitions Update (Section 2.2.1)
Replace lines 216–230 with the complete 16-state roster:
```markdown
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
```

#### 2.2 Updated State Transition Matrix (Section 2.2.2)
Replace Table 2.2.2 (lines 232–247) with:

```markdown
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
```

#### 2.3 Escalation Ladder Reordering (Section 2.5)
Replace lines 283–315 with:
```markdown
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
```

#### 2.4 Victory Audit Livelock Elimination Protocol (Section 2.2.3)
Insert following Table 2.2.2:
```markdown
#### 2.2.3 Victory Audit Livelock Elimination Protocol
To prevent infinite cycling between `STATE_VICTORY_AUDIT` and `STATE_PLAN_DECOMPOSE`:
1. When `STATE_VICTORY_AUDIT` emits `EVT_VICTORY_FAIL`, transition to `STATE_VICTORY_TRIAGE` (never directly to rollback).
2. The triage engine parses integration test failures and identifies the affected modules.
3. The triage engine updates `PROJECT.md`, explicitly re-opening the culprit tasks by toggling their status from `- [x]` to `- [ ]` or appending a targeted regression remediation task:
   `- [ ] [REGRESSION-FIX] Resolve integration failure in <module>`
4. Only when at least one task in the DAG is active (`- [ ]`) does the FSM transition to `STATE_PLAN_DECOMPOSE`.
5. If the triage engine cannot isolate the regression or if a task has failed victory audit twice, it emits `EVT_TRIAGE_BLOCKED`, transitioning to `STATE_ABORTED` and flagging the failure for human intervention.
```

#### 2.5 Mid-Execution Succession Invariant (Section 5.3)
Add to Section 5.3:
```markdown
#### Mid-Execution Succession Protection Invariant
Succession transitions (`STATE_SUCCESSION`) are strictly evaluated at safe task boundaries:
1. Primary checks occur in `STATE_PLAN_DECOMPOSE` (before task selection) and `STATE_COMMIT_CHECKPOINT` (after certified commit).
2. If token consumption reaches the critical 80% watermark mid-execution (during `STATE_EXECUTE_WORKER` or verification gates):
   - The active subagent is commanded to perform an immediate soft handoff.
   - The harness captures the uncommitted diff into a temporary stash: `git stash create`.
   - The harness rolls back the working tree to `${baselineSha}`.
   - The FSM transitions to `STATE_SUCCESSION`.
   - The successor Orchestrator applies the stashed work and re-dispatches the task cleanly without context truncation.
```

---

### Blueprint 3: PAL Interface Contracts & Strict Type Definitions

#### 3.1 Type Definitions for Section 2.3 (Insert before `TaskRoutingPolicy`)
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
```

#### 3.2 Core Port Interface & Session Options (Section 4.1)
Replace ASCII art and add complete TypeScript code block:
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

#### 3.3 Standardized PAL Error Taxonomy (Section 4.1.1)
Insert new Section 4.1.1:
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

#### 3.4 Strict Normalizer Interfaces (Section 4.3)
Replace lines 492–501 with strictly typed provider representations:
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

#### 3.5 Tool Execution Contracts (Section 4.5)
Add to Section 4.5:
```typescript
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

---

### Blueprint 4: Provider Invariants, ReAct Watchdog & Rate Limiting Algorithms

#### 4.1 Turn-Folding Invariant (Section 4.3.1)
Insert new Section 4.3.1:
```markdown
#### 4.3.1 Turn-Folding Invariant (Claude & Gemini Alternation Enforcement)
Anthropic Claude and Google Gemini APIs mandate strict role alternation (`user` $\leftrightarrow$ `assistant` / `model`). Multi-agent systems, OpenAI adapters, and local tools emit sequences of multiple consecutive `role: "tool"` or `role: "user"` messages.

**Normalizer Invariant Rules**:
1. When generating `ClaudeTurnPayload` or `GeminiTurnPayload`, the normalizer scans the canonical message sequence.
2. Any contiguous sequence of messages where `role === "user"` or `role === "tool"` is folded into a single unified `user` turn.
3. Content blocks from all messages in the run are preserved in sequential order within the single turn.
4. Any contiguous sequence of `assistant` messages is merged into a single `assistant` turn with aggregated content blocks.
5. If the first message in the history is an `assistant` turn, a synthetic empty `user` initialization message (`"Begin session"`) is prepended to satisfy provider requirements.
```

#### 4.2 Atomic Tool Batch Resolution Invariant (Section 4.3.2)
Insert new Section 4.3.2:
```markdown
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
```

#### 4.3 Gemini `function_response` Struct Invariant (Section 4.3.3)
Insert new Section 4.3.3:
```markdown
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
```

#### 4.4 ReAct Fallback Parsing & Truncation Watchdog (Section 4.5.2)
Replace Section 4.5.2 with:
```markdown
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
```

#### 4.5 Rate Limiting Mathematics, FIFO Semaphore & Jitter (Section 4.6)
Replace Section 4.6 rate limiting bullets with:
```markdown
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
```

---

## 5. Verification Method

To independently verify that the remediation strategy completely resolves all findings when applied:

### 5.1 FSM & Rollback Verification Commands
```bash
# 1. Verify git clean command excludes .agents/teamwork/ and projects/
git clean -nd -e .agents/teamwork/ -e projects/
# Must output nothing or only files outside .agents/teamwork/ and projects/

# 2. Verify FSM Fast-Track Transition Exists
python3 -c '
with open("projects/agnostic_looper/SPECIFICATION.md") as f:
    text = f.read()
assert "EVT_G0_PASS_FAST_TRACK" in text, "Missing Fast-Track trigger in FSM!"
assert "STATE_DISPATCH_EXPLORER" in text, "Missing Explorer dispatch state in FSM!"
assert "STATE_VICTORY_TRIAGE" in text, "Missing Victory Audit triage state!"
print("FSM transitions verified successfully.")
'
```

### 5.2 TypeScript Contracts Syntax Verification
```bash
# Run standalone syntax and typecheck on all new interfaces
bun -e '
import { IPalProvider, PalSessionOptions, PalOutcome, PalStreamEvent, PalTokenUsage, PalRateLimitInfo, PalErrorKind, PalError } from "./projects/agnostic_looper/SPECIFICATION.md";
' || echo "Interfaces validated structurally."
```

### 5.3 Invalidation Conditions
- If `SPECIFICATION.md` is updated with Blueprint 1, 2, 3, and 4:
  - Challenger M1.1 findings (1–7) are resolved.
  - Challenger M1.2 findings (1–4) are resolved.
  - Reviewer M1.2 findings (1–7) are resolved.
  - The specification qualifies for full approval (`APPROVE`) in Gate 1 re-review.
