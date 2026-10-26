/**
 * Finite State Machine (FSM) State Definitions & Transition Matrix.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 2.
 *
 * Establishes the 18 states (16 non-terminal + 2 terminal), all 37 distinct domain events,
 * and the complete 39-transition matrix with transition guards, reachability topology,
 * and strict error taxonomy.
 */

/**
 * Central FSM constants ensuring zero magic numbers.
 */
export const FSM_CONSTANTS = {
  TOTAL_STATES_COUNT: 18,
  NON_TERMINAL_STATES_COUNT: 16,
  TERMINAL_STATES_COUNT: 2,
  TOTAL_TRANSITIONS_COUNT: 39,
  DEFAULT_MAX_ATTEMPTS: 3,
  DEFAULT_MAX_CHALLENGE_ATTEMPTS: 2,
  DEFAULT_SPAWN_LIMIT: 16,
  DEFAULT_TOKEN_WATERMARK_PERCENT: 80,
  MAX_VICTORY_AUDIT_FAILURES: 2,
  INITIAL_STATE: "STATE_INIT",
  TERMINAL_STATE_COMPLETED: "STATE_COMPLETED",
  TERMINAL_STATE_ABORTED: "STATE_ABORTED",
  CIRCUIT_BREAKER_CLOSED: "CLOSED",
  CIRCUIT_BREAKER_ESCALATED: "ESCALATED",
} as const;

/**
 * Circuit breaker states for Victory Audit livelock prevention.
 */
export const CIRCUIT_BREAKER_STATES = {
  CLOSED: "CLOSED",
  ESCALATED: "ESCALATED",
} as const;

export type CircuitBreakerState =
  (typeof CIRCUIT_BREAKER_STATES)[keyof typeof CIRCUIT_BREAKER_STATES];

/**
 * Complete enumeration of the 18 deterministic FSM lifecycle states.
 * Consists of 16 active operational states and 2 terminal states.
 */
export const LOOPER_STATES = {
  STATE_INIT: "STATE_INIT",
  STATE_PLAN_DECOMPOSE: "STATE_PLAN_DECOMPOSE",
  STATE_DISPATCH_WORKER: "STATE_DISPATCH_WORKER",
  STATE_EXECUTE_WORKER: "STATE_EXECUTE_WORKER",
  STATE_DISPATCH_EXPLORER: "STATE_DISPATCH_EXPLORER",
  STATE_EXECUTE_EXPLORER: "STATE_EXECUTE_EXPLORER",
  STATE_GATE_0_AUTO: "STATE_GATE_0_AUTO",
  STATE_GATE_1_REVIEW: "STATE_GATE_1_REVIEW",
  STATE_GATE_2_CHALLENGE: "STATE_GATE_2_CHALLENGE",
  STATE_GATE_3_AUDIT: "STATE_GATE_3_AUDIT",
  STATE_COMMIT_CHECKPOINT: "STATE_COMMIT_CHECKPOINT",
  STATE_ESCALATE_DIAGNOSTIC: "STATE_ESCALATE_DIAGNOSTIC",
  STATE_ROLLBACK_RECOVERY: "STATE_ROLLBACK_RECOVERY",
  STATE_VICTORY_TRIAGE: "STATE_VICTORY_TRIAGE",
  STATE_SUCCESSION: "STATE_SUCCESSION",
  STATE_VICTORY_AUDIT: "STATE_VICTORY_AUDIT",
  STATE_COMPLETED: "STATE_COMPLETED",
  STATE_ABORTED: "STATE_ABORTED",
} as const;

export type LooperState = (typeof LOOPER_STATES)[keyof typeof LOOPER_STATES];

/**
 * Terminal states with zero outgoing transitions.
 */
export const TERMINAL_STATES = [
  LOOPER_STATES.STATE_COMPLETED,
  LOOPER_STATES.STATE_ABORTED,
] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

/**
 * The 16 active operational states with declared outgoing transitions.
 */
export const NON_TERMINAL_STATES = [
  LOOPER_STATES.STATE_INIT,
  LOOPER_STATES.STATE_PLAN_DECOMPOSE,
  LOOPER_STATES.STATE_DISPATCH_WORKER,
  LOOPER_STATES.STATE_EXECUTE_WORKER,
  LOOPER_STATES.STATE_DISPATCH_EXPLORER,
  LOOPER_STATES.STATE_EXECUTE_EXPLORER,
  LOOPER_STATES.STATE_GATE_0_AUTO,
  LOOPER_STATES.STATE_GATE_1_REVIEW,
  LOOPER_STATES.STATE_GATE_2_CHALLENGE,
  LOOPER_STATES.STATE_GATE_3_AUDIT,
  LOOPER_STATES.STATE_COMMIT_CHECKPOINT,
  LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
  LOOPER_STATES.STATE_ROLLBACK_RECOVERY,
  LOOPER_STATES.STATE_VICTORY_TRIAGE,
  LOOPER_STATES.STATE_SUCCESSION,
  LOOPER_STATES.STATE_VICTORY_AUDIT,
] as const;

export type NonTerminalState = (typeof NON_TERMINAL_STATES)[number];

/**
 * Complete enumeration of typed domain events triggering state transitions.
 */
export const LOOPER_EVENTS = {
  EVT_INIT_SUCCESS: "EVT_INIT_SUCCESS",
  EVT_FATAL_ERROR: "EVT_FATAL_ERROR",
  EVT_TASK_SELECTED_WORKER: "EVT_TASK_SELECTED_WORKER",
  EVT_TASK_SELECTED_EXPLORER: "EVT_TASK_SELECTED_EXPLORER",
  EVT_ALL_TASKS_DONE: "EVT_ALL_TASKS_DONE",
  EVT_SPAWN_LIMIT: "EVT_SPAWN_LIMIT",
  EVT_WORKER_SPAWNED: "EVT_WORKER_SPAWNED",
  EVT_SPAWN_FAILED: "EVT_SPAWN_FAILED",
  EVT_WORK_SUBMITTED: "EVT_WORK_SUBMITTED",
  EVT_WORKER_TIMEOUT: "EVT_WORKER_TIMEOUT",
  EVT_EXPLORER_SPAWNED: "EVT_EXPLORER_SPAWNED",
  EVT_EXPLORATION_COMPLETE: "EVT_EXPLORATION_COMPLETE",
  EVT_EXPLORER_TIMEOUT: "EVT_EXPLORER_TIMEOUT",
  EVT_G0_PASS: "EVT_G0_PASS",
  EVT_G0_PASS_FAST_TRACK: "EVT_G0_PASS_FAST_TRACK",
  EVT_G0_RETRY: "EVT_G0_RETRY",
  EVT_G0_EXHAUSTED: "EVT_G0_EXHAUSTED",
  EVT_G1_PASS: "EVT_G1_PASS",
  EVT_G1_REVISE: "EVT_G1_REVISE",
  EVT_G1_REJECT: "EVT_G1_REJECT",
  EVT_G2_PASS: "EVT_G2_PASS",
  EVT_G2_BREAK: "EVT_G2_BREAK",
  EVT_G2_EXHAUSTED: "EVT_G2_EXHAUSTED",
  EVT_G3_PASS: "EVT_G3_PASS",
  EVT_G3_VETO: "EVT_G3_VETO",
  EVT_DIAGNOSTIC_RETRY: "EVT_DIAGNOSTIC_RETRY",
  EVT_ROLLBACK_REQUIRED: "EVT_ROLLBACK_REQUIRED",
  EVT_ESCALATION_FATAL: "EVT_ESCALATION_FATAL",
  EVT_ESCALATION_RESOLVED: "EVT_ESCALATION_RESOLVED",
  EVT_REDECOMPOSE_REQUIRED: "EVT_REDECOMPOSE_REQUIRED",
  EVT_ESCALATION_FAILED: "EVT_ESCALATION_FAILED",
  EVT_CHECKPOINT_COMMITTED: "EVT_CHECKPOINT_COMMITTED",
  EVT_SUCCESSION_COMPLETE: "EVT_SUCCESSION_COMPLETE",
  EVT_VICTORY_PASS: "EVT_VICTORY_PASS",
  EVT_VICTORY_FAIL: "EVT_VICTORY_FAIL",
  EVT_TRIAGE_REOPENED: "EVT_TRIAGE_REOPENED",
  EVT_TRIAGE_BLOCKED: "EVT_TRIAGE_BLOCKED",
} as const;

export type LooperEvent = (typeof LOOPER_EVENTS)[keyof typeof LOOPER_EVENTS];

/**
 * Definition of an individual state transition rule.
 */
export interface FsmTransitionRule {
  readonly fromState: LooperState;
  readonly event: LooperEvent;
  readonly toState: LooperState;
  readonly guardCondition: string;
  readonly description?: string;
}

/**
 * Complete list of all 39 transitions conforming strictly to SPECIFICATION.md Section 2.2.2.
 */
export const FSM_TRANSITION_RULES: readonly FsmTransitionRule[] = [
  // STATE_INIT (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_INIT,
    event: LOOPER_EVENTS.EVT_INIT_SUCCESS,
    toState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    guardCondition: "Git status clean, PAL providers healthy.",
    description: "Environment valid, provider auth verified, clean tree verified.",
  },
  {
    fromState: LOOPER_STATES.STATE_INIT,
    event: LOOPER_EVENTS.EVT_FATAL_ERROR,
    toState: LOOPER_STATES.STATE_ABORTED,
    guardCondition: "Missing auth, corrupted env, or fatal init error.",
    description: "Initialization failure halts execution immediately.",
  },

  // STATE_PLAN_DECOMPOSE (4 transitions)
  {
    fromState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    event: LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER,
    toState: LOOPER_STATES.STATE_DISPATCH_WORKER,
    guardCondition: 'Next task is implementation (role === "worker").',
    description: "Topological task selected requiring code mutation by worker.",
  },
  {
    fromState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    event: LOOPER_EVENTS.EVT_TASK_SELECTED_EXPLORER,
    toState: LOOPER_STATES.STATE_DISPATCH_EXPLORER,
    guardCondition: 'Next task is exploration (role === "explorer").',
    description: "Topological task selected requiring read-only codebase exploration.",
  },
  {
    fromState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    event: LOOPER_EVENTS.EVT_ALL_TASKS_DONE,
    toState: LOOPER_STATES.STATE_VICTORY_AUDIT,
    guardCondition: "All tasks marked - [x].",
    description: "All planned DAG tasks complete, proceed to holistic victory audit.",
  },
  {
    fromState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    event: LOOPER_EVENTS.EVT_SPAWN_LIMIT,
    toState: LOOPER_STATES.STATE_SUCCESSION,
    guardCondition: "Spawn count >= 16 or tokens >= 80%.",
    description: "Succession boundary triggered before task selection.",
  },

  // STATE_DISPATCH_WORKER (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_DISPATCH_WORKER,
    event: LOOPER_EVENTS.EVT_WORKER_SPAWNED,
    toState: LOOPER_STATES.STATE_EXECUTE_WORKER,
    guardCondition: "Worker workspace created successfully.",
    description: "Worker sandbox initialized, commence task execution.",
  },
  {
    fromState: LOOPER_STATES.STATE_DISPATCH_WORKER,
    event: LOOPER_EVENTS.EVT_SPAWN_FAILED,
    toState: LOOPER_STATES.STATE_ROLLBACK_RECOVERY,
    guardCondition: "Subagent launch failed or timed out.",
    description: "Worker launch failed, roll back and escalate.",
  },

  // STATE_EXECUTE_WORKER (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_EXECUTE_WORKER,
    event: LOOPER_EVENTS.EVT_WORK_SUBMITTED,
    toState: LOOPER_STATES.STATE_GATE_0_AUTO,
    guardCondition: "Worker emitted completion signal.",
    description: "Worker finished changes, proceed to Gate 0 mechanical verification.",
  },
  {
    fromState: LOOPER_STATES.STATE_EXECUTE_WORKER,
    event: LOOPER_EVENTS.EVT_WORKER_TIMEOUT,
    toState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    guardCondition: "Worker hung or exceeded time limit.",
    description: "Worker timed out, preserve dirty tree for diagnosis.",
  },

  // STATE_DISPATCH_EXPLORER (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_DISPATCH_EXPLORER,
    event: LOOPER_EVENTS.EVT_EXPLORER_SPAWNED,
    toState: LOOPER_STATES.STATE_EXECUTE_EXPLORER,
    guardCondition: "Explorer workspace created successfully.",
    description: "Explorer sandbox initialized, commence read-only survey.",
  },
  {
    fromState: LOOPER_STATES.STATE_DISPATCH_EXPLORER,
    event: LOOPER_EVENTS.EVT_SPAWN_FAILED,
    toState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    guardCondition: "Process launch failed.",
    description: "Explorer spawn failed, route to diagnostic escalation.",
  },

  // STATE_EXECUTE_EXPLORER (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_EXECUTE_EXPLORER,
    event: LOOPER_EVENTS.EVT_EXPLORATION_COMPLETE,
    toState: LOOPER_STATES.STATE_GATE_3_AUDIT,
    guardCondition: "Explorer produced analysis/handoff report.",
    description: "Explorer delivered report, proceed directly to Gate 3 audit.",
  },
  {
    fromState: LOOPER_STATES.STATE_EXECUTE_EXPLORER,
    event: LOOPER_EVENTS.EVT_EXPLORER_TIMEOUT,
    toState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    guardCondition: "Explorer process hung or timed out.",
    description: "Explorer timed out, escalate diagnostic.",
  },

  // STATE_GATE_0_AUTO (4 transitions)
  {
    fromState: LOOPER_STATES.STATE_GATE_0_AUTO,
    event: LOOPER_EVENTS.EVT_G0_PASS,
    toState: LOOPER_STATES.STATE_GATE_1_REVIEW,
    guardCondition: "Exit code 0 for all checks (Full-Gate policy).",
    description: "All mechanical QA checks passed, proceed to Gate 1 semantic review.",
  },
  {
    fromState: LOOPER_STATES.STATE_GATE_0_AUTO,
    event: LOOPER_EVENTS.EVT_G0_PASS_FAST_TRACK,
    toState: LOOPER_STATES.STATE_GATE_3_AUDIT,
    guardCondition: "Exit code 0 and isFastTrack(task) === true.",
    description: "Fast-track documentation/config change bypasses Gates 1 and 2.",
  },
  {
    fromState: LOOPER_STATES.STATE_GATE_0_AUTO,
    event: LOOPER_EVENTS.EVT_G0_RETRY,
    toState: LOOPER_STATES.STATE_EXECUTE_WORKER,
    guardCondition: "Exit code != 0 and Attempts < MaxAttempts (default: 3).",
    description: "Mechanical check failed, inject failure trace back to Worker for local retry.",
  },
  {
    fromState: LOOPER_STATES.STATE_GATE_0_AUTO,
    event: LOOPER_EVENTS.EVT_G0_EXHAUSTED,
    toState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    guardCondition: "Attempts >= MaxAttempts (preserves dirty diff for Rungs 2–3).",
    description: "Local retries exhausted, preserve dirty diff for Challenger/Explorer diagnosis.",
  },

  // STATE_GATE_1_REVIEW (3 transitions)
  {
    fromState: LOOPER_STATES.STATE_GATE_1_REVIEW,
    event: LOOPER_EVENTS.EVT_G1_PASS,
    toState: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
    guardCondition: "Reviewer verdict APPROVED.",
    description: "Reviewer approved diff, proceed to Gate 2 adversarial challenge.",
  },
  {
    fromState: LOOPER_STATES.STATE_GATE_1_REVIEW,
    event: LOOPER_EVENTS.EVT_G1_REVISE,
    toState: LOOPER_STATES.STATE_EXECUTE_WORKER,
    guardCondition: "Reviewer requested revisions (Attempts < MaxAttempts).",
    description: "Reviewer requested revisions, feed feedback to active Worker.",
  },
  {
    fromState: LOOPER_STATES.STATE_GATE_1_REVIEW,
    event: LOOPER_EVENTS.EVT_G1_REJECT,
    toState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    guardCondition: "Severe violations or attempts exhausted.",
    description: "Reviewer rejected changes, escalate to diagnostic.",
  },

  // STATE_GATE_2_CHALLENGE (3 transitions)
  {
    fromState: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
    event: LOOPER_EVENTS.EVT_G2_PASS,
    toState: LOOPER_STATES.STATE_GATE_3_AUDIT,
    guardCondition: "Challenger failed to break implementation.",
    description: "Adversarial stress testing survived, advance to Gate 3 forensic audit.",
  },
  {
    fromState: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
    event: LOOPER_EVENTS.EVT_G2_BREAK,
    toState: LOOPER_STATES.STATE_EXECUTE_WORKER,
    guardCondition: "Breaking test found (Attempts < MaxChallengeAttempts, default: 2).",
    description: "Challenger found breaking test probe, feed reproduction script to Worker.",
  },
  {
    fromState: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
    event: LOOPER_EVENTS.EVT_G2_EXHAUSTED,
    toState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    guardCondition: "Attempts >= MaxChallengeAttempts (prevents infinite ping-pong).",
    description: "Challenger retry limit reached, escalate to diagnostic.",
  },

  // STATE_GATE_3_AUDIT (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_GATE_3_AUDIT,
    event: LOOPER_EVENTS.EVT_G3_PASS,
    toState: LOOPER_STATES.STATE_COMMIT_CHECKPOINT,
    guardCondition: "Forensic Auditor verified all invariants.",
    description: "Forensic audit verified all invariants, advance to certified git commit.",
  },
  {
    fromState: LOOPER_STATES.STATE_GATE_3_AUDIT,
    event: LOOPER_EVENTS.EVT_G3_VETO,
    toState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    guardCondition: "Auditor exercised binary veto.",
    description: "Forensic auditor vetoed changes, escalate to diagnostic.",
  },

  // STATE_ESCALATE_DIAGNOSTIC (3 transitions)
  {
    fromState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    event: LOOPER_EVENTS.EVT_DIAGNOSTIC_RETRY,
    toState: LOOPER_STATES.STATE_EXECUTE_WORKER,
    guardCondition: "Challenger produced repro script; fed to active Worker (Rung 2).",
    description: "Diagnostic synthesized reproduction script, retry active Worker.",
  },
  {
    fromState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    event: LOOPER_EVENTS.EVT_ROLLBACK_REQUIRED,
    toState: LOOPER_STATES.STATE_ROLLBACK_RECOVERY,
    guardCondition: "Explorer produced remediation.patch or diagnostic finished; ready for rollback (Rungs 3–4).",
    description: "Diagnostic report or patch ready, proceed to atomic git rollback.",
  },
  {
    fromState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
    event: LOOPER_EVENTS.EVT_ESCALATION_FATAL,
    toState: LOOPER_STATES.STATE_ABORTED,
    guardCondition: "Unrecoverable architectural failure; escalate to Sentinel (Rung 6).",
    description: "Fatal failure in diagnostic escalation, abort execution.",
  },

  // STATE_ROLLBACK_RECOVERY (3 transitions)
  {
    fromState: LOOPER_STATES.STATE_ROLLBACK_RECOVERY,
    event: LOOPER_EVENTS.EVT_ESCALATION_RESOLVED,
    toState: LOOPER_STATES.STATE_DISPATCH_WORKER,
    guardCondition: "Working tree reset; fresh Worker spawned with Explorer patch (Rung 4).",
    description: "Working tree reset cleanly, dispatch replacement Worker with patch proposal.",
  },
  {
    fromState: LOOPER_STATES.STATE_ROLLBACK_RECOVERY,
    event: LOOPER_EVENTS.EVT_REDECOMPOSE_REQUIRED,
    toState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    guardCondition: "Task flagged as compound; returning to DAG for splitting (Rung 5).",
    description: "Compound task returned to DAG for topological splitting.",
  },
  {
    fromState: LOOPER_STATES.STATE_ROLLBACK_RECOVERY,
    event: LOOPER_EVENTS.EVT_ESCALATION_FAILED,
    toState: LOOPER_STATES.STATE_ABORTED,
    guardCondition: "Escalation exhausted; task marked BLOCKED (Rung 6).",
    description: "All recovery options exhausted, abort task and require human intervention.",
  },

  // STATE_COMMIT_CHECKPOINT (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_COMMIT_CHECKPOINT,
    event: LOOPER_EVENTS.EVT_CHECKPOINT_COMMITTED,
    toState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    guardCondition: "Git commit successful; checkbox marked - [x].",
    description: "Certified git commit completed, update task catalog and select next task.",
  },
  {
    fromState: LOOPER_STATES.STATE_COMMIT_CHECKPOINT,
    event: LOOPER_EVENTS.EVT_SPAWN_LIMIT,
    toState: LOOPER_STATES.STATE_SUCCESSION,
    guardCondition: "Spawn counter >= 16 or tokens >= 80%.",
    description: "Succession boundary reached at checkpoint commit.",
  },

  // STATE_SUCCESSION (1 transition)
  {
    fromState: LOOPER_STATES.STATE_SUCCESSION,
    event: LOOPER_EVENTS.EVT_SUCCESSION_COMPLETE,
    toState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    guardCondition: "Successor initialized; context handed over cleanly.",
    description: "Successor orchestrator initialized, resume loop at plan decomposition.",
  },

  // STATE_VICTORY_AUDIT (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_VICTORY_AUDIT,
    event: LOOPER_EVENTS.EVT_VICTORY_PASS,
    toState: LOOPER_STATES.STATE_COMPLETED,
    guardCondition: "Entire project passes final holistic audit.",
    description: "Holistic verification passed across entire codebase, mark project complete.",
  },
  {
    fromState: LOOPER_STATES.STATE_VICTORY_AUDIT,
    event: LOOPER_EVENTS.EVT_VICTORY_FAIL,
    toState: LOOPER_STATES.STATE_VICTORY_TRIAGE,
    guardCondition: "Regressions found in end-to-end integration.",
    description: "Victory audit failed, transition to triage to isolate regressions and prevent livelock.",
  },

  // STATE_VICTORY_TRIAGE (2 transitions)
  {
    fromState: LOOPER_STATES.STATE_VICTORY_TRIAGE,
    event: LOOPER_EVENTS.EVT_TRIAGE_REOPENED,
    toState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
    guardCondition: "Culprit tasks unmarked to - [ ] or remediation tasks injected.",
    description: "Culprit tasks re-opened or remediation injected, return to DAG scheduling.",
  },
  {
    fromState: LOOPER_STATES.STATE_VICTORY_TRIAGE,
    event: LOOPER_EVENTS.EVT_TRIAGE_BLOCKED,
    toState: LOOPER_STATES.STATE_ABORTED,
    guardCondition: "Unrecoverable systemic breakdown; Sentinel escalates to human.",
    description: "Repeated victory audit failure or unisolable breakdown, abort and escalate.",
  },
];

/**
 * 16-State Transition Matrix mapping each state to its allowed transition rules.
 * Terminal states (STATE_COMPLETED, STATE_ABORTED) map to empty transition arrays.
 */
export const FSM_TRANSITION_MATRIX: Readonly<
  Record<LooperState, readonly FsmTransitionRule[]>
> = {
  [LOOPER_STATES.STATE_INIT]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_INIT
    )
  ),
  [LOOPER_STATES.STATE_PLAN_DECOMPOSE]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_PLAN_DECOMPOSE
    )
  ),
  [LOOPER_STATES.STATE_DISPATCH_WORKER]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_DISPATCH_WORKER
    )
  ),
  [LOOPER_STATES.STATE_EXECUTE_WORKER]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_EXECUTE_WORKER
    )
  ),
  [LOOPER_STATES.STATE_DISPATCH_EXPLORER]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_DISPATCH_EXPLORER
    )
  ),
  [LOOPER_STATES.STATE_EXECUTE_EXPLORER]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_EXECUTE_EXPLORER
    )
  ),
  [LOOPER_STATES.STATE_GATE_0_AUTO]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_GATE_0_AUTO
    )
  ),
  [LOOPER_STATES.STATE_GATE_1_REVIEW]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_GATE_1_REVIEW
    )
  ),
  [LOOPER_STATES.STATE_GATE_2_CHALLENGE]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_GATE_2_CHALLENGE
    )
  ),
  [LOOPER_STATES.STATE_GATE_3_AUDIT]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_GATE_3_AUDIT
    )
  ),
  [LOOPER_STATES.STATE_COMMIT_CHECKPOINT]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_COMMIT_CHECKPOINT
    )
  ),
  [LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC
    )
  ),
  [LOOPER_STATES.STATE_ROLLBACK_RECOVERY]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_ROLLBACK_RECOVERY
    )
  ),
  [LOOPER_STATES.STATE_VICTORY_TRIAGE]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_VICTORY_TRIAGE
    )
  ),
  [LOOPER_STATES.STATE_SUCCESSION]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_SUCCESSION
    )
  ),
  [LOOPER_STATES.STATE_VICTORY_AUDIT]: Object.freeze(
    FSM_TRANSITION_RULES.filter(
      (rule) => rule.fromState === LOOPER_STATES.STATE_VICTORY_AUDIT
    )
  ),
  [LOOPER_STATES.STATE_COMPLETED]: Object.freeze([]),
  [LOOPER_STATES.STATE_ABORTED]: Object.freeze([]),
};

/**
 * Pre-indexed state adjacency graph mapping source states to allowed next states.
 */
export const FSM_STATE_ADJACENCY: Readonly<
  Record<LooperState, readonly LooperState[]>
> = Object.freeze({
  [LOOPER_STATES.STATE_INIT]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_INIT].map((r) => r.toState)
  ),
  [LOOPER_STATES.STATE_PLAN_DECOMPOSE]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_PLAN_DECOMPOSE].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_DISPATCH_WORKER]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_DISPATCH_WORKER].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_EXECUTE_WORKER]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_EXECUTE_WORKER].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_DISPATCH_EXPLORER]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_DISPATCH_EXPLORER].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_EXECUTE_EXPLORER]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_EXECUTE_EXPLORER].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_GATE_0_AUTO]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_GATE_0_AUTO].map((r) => r.toState)
  ),
  [LOOPER_STATES.STATE_GATE_1_REVIEW]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_GATE_1_REVIEW].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_GATE_2_CHALLENGE]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_GATE_2_CHALLENGE].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_GATE_3_AUDIT]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_GATE_3_AUDIT].map((r) => r.toState)
  ),
  [LOOPER_STATES.STATE_COMMIT_CHECKPOINT]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_COMMIT_CHECKPOINT].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_ROLLBACK_RECOVERY]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_ROLLBACK_RECOVERY].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_VICTORY_TRIAGE]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_VICTORY_TRIAGE].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_SUCCESSION]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_SUCCESSION].map((r) => r.toState)
  ),
  [LOOPER_STATES.STATE_VICTORY_AUDIT]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_VICTORY_AUDIT].map(
      (r) => r.toState
    )
  ),
  [LOOPER_STATES.STATE_COMPLETED]: Object.freeze([]),
  [LOOPER_STATES.STATE_ABORTED]: Object.freeze([]),
});

/**
 * Pre-indexed event trigger map mapping source states to allowed trigger events.
 */
export const FSM_ALLOWED_EVENTS: Readonly<
  Record<LooperState, readonly LooperEvent[]>
> = Object.freeze({
  [LOOPER_STATES.STATE_INIT]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_INIT].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_PLAN_DECOMPOSE]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_PLAN_DECOMPOSE].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_DISPATCH_WORKER]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_DISPATCH_WORKER].map(
      (r) => r.event
    )
  ),
  [LOOPER_STATES.STATE_EXECUTE_WORKER]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_EXECUTE_WORKER].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_DISPATCH_EXPLORER]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_DISPATCH_EXPLORER].map(
      (r) => r.event
    )
  ),
  [LOOPER_STATES.STATE_EXECUTE_EXPLORER]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_EXECUTE_EXPLORER].map(
      (r) => r.event
    )
  ),
  [LOOPER_STATES.STATE_GATE_0_AUTO]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_GATE_0_AUTO].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_GATE_1_REVIEW]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_GATE_1_REVIEW].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_GATE_2_CHALLENGE]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_GATE_2_CHALLENGE].map(
      (r) => r.event
    )
  ),
  [LOOPER_STATES.STATE_GATE_3_AUDIT]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_GATE_3_AUDIT].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_COMMIT_CHECKPOINT]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_COMMIT_CHECKPOINT].map(
      (r) => r.event
    )
  ),
  [LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC].map(
      (r) => r.event
    )
  ),
  [LOOPER_STATES.STATE_ROLLBACK_RECOVERY]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_ROLLBACK_RECOVERY].map(
      (r) => r.event
    )
  ),
  [LOOPER_STATES.STATE_VICTORY_TRIAGE]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_VICTORY_TRIAGE].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_SUCCESSION]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_SUCCESSION].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_VICTORY_AUDIT]: Object.freeze(
    FSM_TRANSITION_MATRIX[LOOPER_STATES.STATE_VICTORY_AUDIT].map((r) => r.event)
  ),
  [LOOPER_STATES.STATE_COMPLETED]: Object.freeze([]),
  [LOOPER_STATES.STATE_ABORTED]: Object.freeze([]),
});

/**
 * Type guard for checking if a state is a terminal state.
 */
export function isTerminalState(state: LooperState): state is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Type guard for checking if a state is a non-terminal operational state.
 */
export function isNonTerminalState(
  state: LooperState
): state is NonTerminalState {
  return (NON_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Type guard for validating arbitrary strings against the LooperState union.
 */
export function isValidState(state: unknown): state is LooperState {
  return (
    typeof state === "string" &&
    Object.values(LOOPER_STATES).includes(state as LooperState)
  );
}

/**
 * Type guard for validating arbitrary strings against the LooperEvent union.
 */
export function isValidEvent(event: unknown): event is LooperEvent {
  return (
    typeof event === "string" &&
    Object.values(LOOPER_EVENTS).includes(event as LooperEvent)
  );
}

/**
 * Finds the declared transition rule for a given source state and event trigger.
 * Returns undefined if no transition is declared.
 */
export function findTransitionRule(
  fromState: LooperState,
  event: LooperEvent
): FsmTransitionRule | undefined {
  const transitions = FSM_TRANSITION_MATRIX[fromState];
  if (!transitions) {
    return undefined;
  }
  return transitions.find((rule) => rule.event === event);
}

/**
 * Returns all allowed next states for a given source state.
 */
export function getAllowedNextStates(
  fromState: LooperState
): readonly LooperState[] {
  return FSM_STATE_ADJACENCY[fromState] ?? [];
}

/**
 * Returns all allowed trigger events for a given source state.
 */
export function getAllowedEvents(
  fromState: LooperState
): readonly LooperEvent[] {
  return FSM_ALLOWED_EVENTS[fromState] ?? [];
}

/**
 * Checks whether an event trigger can transition from the specified state.
 */
export function canTransition(
  fromState: LooperState,
  event: LooperEvent
): boolean {
  return findTransitionRule(fromState, event) !== undefined;
}

/**
 * Checks whether a direct transition is allowed between two states (regardless of event).
 */
export function isValidNextState(
  fromState: LooperState,
  toState: LooperState
): boolean {
  return getAllowedNextStates(fromState).includes(toState);
}

/**
 * Standardized fatal error thrown when an invalid state transition is attempted.
 * Conforms to SPECIFICATION.md Section 2.1 and OpenSpec requirements.
 */
export class InvalidStateTransitionError extends Error {
  readonly fromState: LooperState | string;
  readonly event: LooperEvent | string;
  readonly toState?: LooperState | string;

  constructor(
    fromState: LooperState | string,
    event: LooperEvent | string,
    message?: string,
    toState?: LooperState | string
  ) {
    const detail =
      message ??
      `Invalid state transition from '${fromState}' on event '${event}'${
        toState ? ` to target state '${toState}'` : ""
      }.`;
    super(`[InvalidStateTransitionError] ${detail}`);
    this.name = "InvalidStateTransitionError";
    this.fromState = fromState;
    this.event = event;
    this.toState = toState;
  }
}

/** Alias to support both naming styles seamlessly. */
export const InvalidStateTransition = InvalidStateTransitionError;
export type InvalidStateTransition = InvalidStateTransitionError;

/**
 * Runtime execution context passed to FSM transition guards and lifecycle engines.
 */
export interface LooperFsmContext {
  taskId?: string;
  taskRole?: "worker" | "explorer";
  gate0Attempts: number;
  gate1Attempts: number;
  gate2Attempts: number;
  victoryFailures: number;
  spawnCount: number;
  tokenUtilizationPercent: number;
  isFastTrack: boolean;
  baselineSha?: string;
  hasActiveDagTasks: boolean;
  circuitBreakerState?: CircuitBreakerState;
  metadata?: Record<string, unknown>;
}

/**
 * Guard predicate evaluated dynamically prior to committing an FSM transition.
 */
export type FsmTransitionGuard = (
  context: LooperFsmContext,
  event: LooperEvent,
  targetRule: FsmTransitionRule
) => boolean | Promise<boolean>;

/**
 * Transition notification payload delivered to FSM lifecycle hooks.
 */
export interface FsmTransitionPayload {
  readonly from: LooperState;
  readonly to: LooperState;
  readonly event: LooperEvent;
  readonly timestamp: number;
  readonly context: Readonly<LooperFsmContext>;
}

/**
 * Callback hook invoked upon successful state transition.
 */
export type FsmTransitionHook = (
  payload: FsmTransitionPayload
) => void | Promise<void>;

/**
 * Immutable snapshot of current FSM state and execution statistics.
 */
export interface FsmSnapshot {
  readonly currentState: LooperState;
  readonly previousState: LooperState | null;
  readonly lastEvent: LooperEvent | null;
  readonly transitionCount: number;
  readonly isTerminal: boolean;
  readonly context: Readonly<LooperFsmContext>;
}
