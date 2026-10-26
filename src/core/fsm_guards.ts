/**
 * Standard Finite State Machine (FSM) Transition Guards.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 2.2.2 and Section 2.2.3.
 *
 * Provides deterministic transition guard predicates validating execution context,
 * task roles, gate retry thresholds, and livelock prevention invariants before
 * state transitions are committed.
 */

import {
  CIRCUIT_BREAKER_STATES,
  FSM_CONSTANTS,
  type FsmTransitionGuard,
  LOOPER_EVENTS,
  LOOPER_STATES,
  type LooperEvent,
  type LooperFsmContext,
  type LooperState,
} from "./fsm_types";

/**
 * Customization options for threshold values in standard transition guards.
 */
export interface StandardGuardOptions {
  readonly maxAttempts?: number;
  readonly maxChallengeAttempts?: number;
  readonly maxVictoryFailures?: number;
  readonly spawnLimit?: number;
  readonly tokenWatermarkPercent?: number;
}

/**
 * Guard predicate for STATE_PLAN_DECOMPOSE -> STATE_DISPATCH_WORKER (EVT_TASK_SELECTED_WORKER).
 * Requires context.taskRole === "worker".
 */
export const planDecomposeWorkerGuard: FsmTransitionGuard = (
  context: LooperFsmContext
): boolean => {
  return context.taskRole === "worker";
};

/**
 * Guard predicate for STATE_PLAN_DECOMPOSE -> STATE_DISPATCH_EXPLORER (EVT_TASK_SELECTED_EXPLORER).
 * Requires context.taskRole === "explorer".
 */
export const planDecomposeExplorerGuard: FsmTransitionGuard = (
  context: LooperFsmContext
): boolean => {
  return context.taskRole === "explorer";
};

/**
 * Guard predicate for STATE_PLAN_DECOMPOSE -> STATE_VICTORY_AUDIT (EVT_ALL_TASKS_DONE).
 * Requires all tasks marked - [x] (hasActiveDagTasks === false).
 * Critical for livelock elimination: prevents re-triggering victory audit while tasks are open.
 */
export const planDecomposeAllTasksDoneGuard: FsmTransitionGuard = (
  context: LooperFsmContext
): boolean => {
  return !context.hasActiveDagTasks;
};

/** Alias for planDecomposeAllTasksDoneGuard */
export const allTasksDoneGuard = planDecomposeAllTasksDoneGuard;

/**
 * Guard predicate for succession transitions (EVT_SPAWN_LIMIT).
 * Triggers when spawnCount >= spawnLimit OR tokenUtilizationPercent >= tokenWatermarkPercent.
 */
export const createSpawnLimitGuard = (
  spawnLimit: number = FSM_CONSTANTS.DEFAULT_SPAWN_LIMIT,
  tokenWatermark: number = FSM_CONSTANTS.DEFAULT_TOKEN_WATERMARK_PERCENT
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    return (
      context.spawnCount >= spawnLimit ||
      context.tokenUtilizationPercent >= tokenWatermark
    );
  };
};

/**
 * Guard predicate for STATE_GATE_0_AUTO -> STATE_GATE_1_REVIEW (EVT_G0_PASS).
 * Requires Full-Gate policy (isFastTrack === false).
 */
export const gate0PassFullGateGuard: FsmTransitionGuard = (
  context: LooperFsmContext
): boolean => {
  return !context.isFastTrack;
};

/**
 * Guard predicate for STATE_GATE_0_AUTO -> STATE_GATE_3_AUDIT (EVT_G0_PASS_FAST_TRACK).
 * Requires Fast-Track policy (isFastTrack === true).
 */
export const gate0PassFastTrackGuard: FsmTransitionGuard = (
  context: LooperFsmContext
): boolean => {
  return Boolean(context.isFastTrack);
};

/**
 * Guard predicate for STATE_GATE_0_AUTO -> STATE_EXECUTE_WORKER (EVT_G0_RETRY).
 * Requires gate0Attempts < maxAttempts.
 */
export const createGate0RetryGuard = (
  maxAttempts: number = FSM_CONSTANTS.DEFAULT_MAX_ATTEMPTS
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    return context.gate0Attempts < maxAttempts;
  };
};

/**
 * Guard predicate for STATE_GATE_0_AUTO -> STATE_ESCALATE_DIAGNOSTIC (EVT_G0_EXHAUSTED).
 * Requires gate0Attempts >= maxAttempts.
 */
export const createGate0ExhaustedGuard = (
  maxAttempts: number = FSM_CONSTANTS.DEFAULT_MAX_ATTEMPTS
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    return context.gate0Attempts >= maxAttempts;
  };
};

/**
 * Guard predicate for STATE_GATE_1_REVIEW -> STATE_EXECUTE_WORKER (EVT_G1_REVISE).
 * Requires gate1Attempts < maxAttempts.
 */
export const createGate1ReviseGuard = (
  maxAttempts: number = FSM_CONSTANTS.DEFAULT_MAX_ATTEMPTS
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    return context.gate1Attempts < maxAttempts;
  };
};

/**
 * Guard predicate for STATE_GATE_1_REVIEW -> STATE_ESCALATE_DIAGNOSTIC (EVT_G1_REJECT).
 * Requires gate1Attempts >= maxAttempts OR severe violation reported in metadata.
 */
export const createGate1RejectGuard = (
  maxAttempts: number = FSM_CONSTANTS.DEFAULT_MAX_ATTEMPTS
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    return (
      context.gate1Attempts >= maxAttempts ||
      Boolean(context.metadata?.severeViolation)
    );
  };
};

/**
 * Guard predicate for STATE_GATE_2_CHALLENGE -> STATE_EXECUTE_WORKER (EVT_G2_BREAK).
 * Requires gate2Attempts < maxChallengeAttempts.
 */
export const createGate2BreakGuard = (
  maxChallengeAttempts: number = FSM_CONSTANTS.DEFAULT_MAX_CHALLENGE_ATTEMPTS
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    return context.gate2Attempts < maxChallengeAttempts;
  };
};

/**
 * Guard predicate for STATE_GATE_2_CHALLENGE -> STATE_ESCALATE_DIAGNOSTIC (EVT_G2_EXHAUSTED).
 * Requires gate2Attempts >= maxChallengeAttempts.
 */
export const createGate2ExhaustedGuard = (
  maxChallengeAttempts: number = FSM_CONSTANTS.DEFAULT_MAX_CHALLENGE_ATTEMPTS
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    return context.gate2Attempts >= maxChallengeAttempts;
  };
};

/**
 * Guard predicate for STATE_VICTORY_TRIAGE -> STATE_PLAN_DECOMPOSE (EVT_TRIAGE_REOPENED).
 * Core of Victory Audit Livelock Prevention Protocol:
 * Requires hasActiveDagTasks === true AND victoryFailures < maxVictoryFailures
 * AND circuitBreakerState !== "ESCALATED".
 */
export const createVictoryTriageReopenedGuard = (
  maxVictoryFailures: number = FSM_CONSTANTS.MAX_VICTORY_AUDIT_FAILURES
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    const hasActiveTasks = Boolean(context.hasActiveDagTasks);
    const belowFailureLimit = context.victoryFailures < maxVictoryFailures;
    const circuitClosed =
      context.circuitBreakerState !== CIRCUIT_BREAKER_STATES.ESCALATED;

    return hasActiveTasks && belowFailureLimit && circuitClosed;
  };
};

/**
 * Guard predicate for STATE_VICTORY_TRIAGE -> STATE_ABORTED (EVT_TRIAGE_BLOCKED).
 * Core of Victory Audit Livelock Prevention Protocol:
 * Allows transition when victoryFailures >= maxVictoryFailures OR hasActiveDagTasks === false
 * OR circuitBreakerState === "ESCALATED".
 */
export const createVictoryTriageBlockedGuard = (
  maxVictoryFailures: number = FSM_CONSTANTS.MAX_VICTORY_AUDIT_FAILURES
): FsmTransitionGuard => {
  return (context: LooperFsmContext): boolean => {
    const reachedFailureLimit = context.victoryFailures >= maxVictoryFailures;
    const noActiveTasks = !context.hasActiveDagTasks;
    const circuitEscalated =
      context.circuitBreakerState === CIRCUIT_BREAKER_STATES.ESCALATED;

    return reachedFailureLimit || noActiveTasks || circuitEscalated;
  };
};

/**
 * Pair of fromState and event keying a transition rule guard.
 */
export interface TransitionGuardEntry {
  readonly fromState: LooperState;
  readonly event: LooperEvent;
  readonly guard: FsmTransitionGuard;
}

/**
 * Generates the full set of standard transition guard entries based on options.
 */
export function createStandardTransitionGuards(
  options?: StandardGuardOptions
): readonly TransitionGuardEntry[] {
  const maxAttempts =
    options?.maxAttempts ?? FSM_CONSTANTS.DEFAULT_MAX_ATTEMPTS;
  const maxChallengeAttempts =
    options?.maxChallengeAttempts ??
    FSM_CONSTANTS.DEFAULT_MAX_CHALLENGE_ATTEMPTS;
  const maxVictoryFailures =
    options?.maxVictoryFailures ?? FSM_CONSTANTS.MAX_VICTORY_AUDIT_FAILURES;
  const spawnLimit =
    options?.spawnLimit ?? FSM_CONSTANTS.DEFAULT_SPAWN_LIMIT;
  const tokenWatermark =
    options?.tokenWatermarkPercent ??
    FSM_CONSTANTS.DEFAULT_TOKEN_WATERMARK_PERCENT;

  return [
    // STATE_PLAN_DECOMPOSE
    {
      fromState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
      event: LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER,
      guard: planDecomposeWorkerGuard,
    },
    {
      fromState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
      event: LOOPER_EVENTS.EVT_TASK_SELECTED_EXPLORER,
      guard: planDecomposeExplorerGuard,
    },
    {
      fromState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
      event: LOOPER_EVENTS.EVT_ALL_TASKS_DONE,
      guard: planDecomposeAllTasksDoneGuard,
    },
    {
      fromState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
      event: LOOPER_EVENTS.EVT_SPAWN_LIMIT,
      guard: createSpawnLimitGuard(spawnLimit, tokenWatermark),
    },

    // STATE_GATE_0_AUTO
    {
      fromState: LOOPER_STATES.STATE_GATE_0_AUTO,
      event: LOOPER_EVENTS.EVT_G0_PASS,
      guard: gate0PassFullGateGuard,
    },
    {
      fromState: LOOPER_STATES.STATE_GATE_0_AUTO,
      event: LOOPER_EVENTS.EVT_G0_PASS_FAST_TRACK,
      guard: gate0PassFastTrackGuard,
    },
    {
      fromState: LOOPER_STATES.STATE_GATE_0_AUTO,
      event: LOOPER_EVENTS.EVT_G0_RETRY,
      guard: createGate0RetryGuard(maxAttempts),
    },
    {
      fromState: LOOPER_STATES.STATE_GATE_0_AUTO,
      event: LOOPER_EVENTS.EVT_G0_EXHAUSTED,
      guard: createGate0ExhaustedGuard(maxAttempts),
    },

    // STATE_GATE_1_REVIEW
    {
      fromState: LOOPER_STATES.STATE_GATE_1_REVIEW,
      event: LOOPER_EVENTS.EVT_G1_REVISE,
      guard: createGate1ReviseGuard(maxAttempts),
    },
    {
      fromState: LOOPER_STATES.STATE_GATE_1_REVIEW,
      event: LOOPER_EVENTS.EVT_G1_REJECT,
      guard: createGate1RejectGuard(maxAttempts),
    },

    // STATE_GATE_2_CHALLENGE
    {
      fromState: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
      event: LOOPER_EVENTS.EVT_G2_BREAK,
      guard: createGate2BreakGuard(maxChallengeAttempts),
    },
    {
      fromState: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
      event: LOOPER_EVENTS.EVT_G2_EXHAUSTED,
      guard: createGate2ExhaustedGuard(maxChallengeAttempts),
    },

    // STATE_COMMIT_CHECKPOINT
    {
      fromState: LOOPER_STATES.STATE_COMMIT_CHECKPOINT,
      event: LOOPER_EVENTS.EVT_SPAWN_LIMIT,
      guard: createSpawnLimitGuard(spawnLimit, tokenWatermark),
    },

    // STATE_VICTORY_TRIAGE (Victory Audit Livelock Prevention)
    {
      fromState: LOOPER_STATES.STATE_VICTORY_TRIAGE,
      event: LOOPER_EVENTS.EVT_TRIAGE_REOPENED,
      guard: createVictoryTriageReopenedGuard(maxVictoryFailures),
    },
    {
      fromState: LOOPER_STATES.STATE_VICTORY_TRIAGE,
      event: LOOPER_EVENTS.EVT_TRIAGE_BLOCKED,
      guard: createVictoryTriageBlockedGuard(maxVictoryFailures),
    },
  ];
}
