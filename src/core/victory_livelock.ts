/**
 * Victory Audit Livelock Elimination Protocol & Circuit Breaker.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 2.2.3 and OpenSpec requirements.
 *
 * Prevents infinite cycling between `STATE_VICTORY_AUDIT` and `STATE_PLAN_DECOMPOSE`
 * by isolating regressions into DAG tasks, guarding against immediate victory re-triggering,
 * and tripping a circuit breaker to `ESCALATED` after repeated failures (threshold: 2).
 */

import {
  CIRCUIT_BREAKER_STATES,
  type CircuitBreakerState,
  FSM_CONSTANTS,
  LOOPER_EVENTS,
  LOOPER_STATES,
  type LooperEvent,
  type LooperState,
} from "./fsm_types";

/**
 * Diagnostic record of a single Victory Audit failure event.
 */
export interface VictoryAuditFailureRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly failureCount: number;
  readonly circuitBreakerState: CircuitBreakerState;
  readonly affectedModules?: readonly string[];
  readonly culpritTaskIds?: readonly string[];
  readonly reason?: string;
}

/**
 * Configuration options for initializing VictoryAuditLivelockPrevention.
 */
export interface VictoryAuditLivelockOptions {
  readonly maxFailures?: number;
  readonly initialCircuitBreakerState?: CircuitBreakerState;
  readonly onCircuitBreakerTrip?: (record: VictoryAuditFailureRecord) => void;
}

/**
 * Parameters for evaluating triage actions following an integration regression.
 */
export interface TriageEvaluationOptions {
  readonly affectedModules?: readonly string[];
  readonly culpritTaskIds?: readonly string[];
  readonly activeTaskCount?: number;
  readonly reason?: string;
}

/**
 * Actionable outcome of a victory triage evaluation.
 */
export interface TriageEvaluationResult {
  readonly action: "reopen" | "block";
  readonly event: LooperEvent;
  readonly targetState: LooperState;
  readonly circuitBreakerState: CircuitBreakerState;
  readonly failureCount: number;
  readonly culpritTaskIds: readonly string[];
  readonly reason: string;
}

/**
 * Manages livelock elimination and circuit breaker state during Victory Audit and Triage.
 */
export class VictoryAuditLivelockPrevention {
  private _failureCount = 0;
  private _circuitBreakerState: CircuitBreakerState = CIRCUIT_BREAKER_STATES.CLOSED;
  private readonly _maxFailures: number;
  private readonly _taskFailureCounts: Map<string, number> = new Map();
  private readonly _moduleFailureCounts: Map<string, number> = new Map();
  private readonly _history: VictoryAuditFailureRecord[] = [];
  private readonly _onTrip?: (record: VictoryAuditFailureRecord) => void;

  constructor(options?: VictoryAuditLivelockOptions) {
    this._maxFailures =
      options?.maxFailures ?? FSM_CONSTANTS.MAX_VICTORY_AUDIT_FAILURES;
    this._circuitBreakerState =
      options?.initialCircuitBreakerState ?? CIRCUIT_BREAKER_STATES.CLOSED;
    this._onTrip = options?.onCircuitBreakerTrip;
  }

  /**
   * Current circuit breaker state ("CLOSED" | "ESCALATED").
   */
  public get circuitBreakerState(): CircuitBreakerState {
    return this._circuitBreakerState;
  }

  /**
   * Cumulative count of victory audit failures in the current cycle.
   */
  public get failureCount(): number {
    return this._failureCount;
  }

  /**
   * Maximum allowed victory audit failures before tripping circuit breaker.
   */
  public get maxFailures(): number {
    return this._maxFailures;
  }

  /**
   * Returns true if the circuit breaker has tripped to ESCALATED.
   */
  public isTripped(): boolean {
    return this._circuitBreakerState === CIRCUIT_BREAKER_STATES.ESCALATED;
  }

  /**
   * Records a victory audit failure, updates module and task statistics,
   * and trips the circuit breaker to ESCALATED if failure threshold is reached.
   */
  public recordFailure(options?: {
    affectedModules?: readonly string[];
    culpritTaskIds?: readonly string[];
    reason?: string;
  }): VictoryAuditFailureRecord {
    this._failureCount += 1;

    if (options?.culpritTaskIds) {
      for (const taskId of options.culpritTaskIds) {
        const current = this._taskFailureCounts.get(taskId) ?? 0;
        this._taskFailureCounts.set(taskId, current + 1);
      }
    }

    if (options?.affectedModules) {
      for (const mod of options.affectedModules) {
        const current = this._moduleFailureCounts.get(mod) ?? 0;
        this._moduleFailureCounts.set(mod, current + 1);
      }
    }

    // Check if any individual task has failed twice or global threshold is reached
    const hasRepeatedTaskFailure = options?.culpritTaskIds?.some(
      (taskId) => (this._taskFailureCounts.get(taskId) ?? 0) >= this._maxFailures
    );

    if (
      this._failureCount >= this._maxFailures ||
      hasRepeatedTaskFailure
    ) {
      this._circuitBreakerState = CIRCUIT_BREAKER_STATES.ESCALATED;
    }

    const record: VictoryAuditFailureRecord = {
      id: `vaf_${Date.now()}_${this._failureCount}`,
      timestamp: Date.now(),
      failureCount: this._failureCount,
      circuitBreakerState: this._circuitBreakerState,
      affectedModules: options?.affectedModules,
      culpritTaskIds: options?.culpritTaskIds,
      reason: options?.reason,
    };

    this._history.push(record);

    if (
      this._circuitBreakerState === CIRCUIT_BREAKER_STATES.ESCALATED &&
      this._onTrip
    ) {
      this._onTrip(record);
    }

    return record;
  }

  /**
   * Explicitly trips the circuit breaker to ESCALATED.
   */
  public tripCircuitBreaker(reason?: string): VictoryAuditFailureRecord {
    this._circuitBreakerState = CIRCUIT_BREAKER_STATES.ESCALATED;

    const record: VictoryAuditFailureRecord = {
      id: `vaf_manual_${Date.now()}`,
      timestamp: Date.now(),
      failureCount: this._failureCount,
      circuitBreakerState: CIRCUIT_BREAKER_STATES.ESCALATED,
      reason: reason ?? "Manual circuit breaker trip; livelock prevention tripped to ESCALATED.",
    };

    this._history.push(record);

    if (this._onTrip) {
      this._onTrip(record);
    }

    return record;
  }

  /**
   * Checks whether tasks can safely be re-opened for planning decomposition.
   * Only returns true if at least one task is active, circuit breaker is closed,
   * and failure count has not reached maximum limit.
   */
  public canReopenTasks(activeTaskCount: number): boolean {
    if (this.isTripped()) {
      return false;
    }
    if (this._failureCount >= this._maxFailures) {
      return false;
    }
    return activeTaskCount > 0;
  }

  /**
   * Evaluates triage conditions following an audit failure and recommends next FSM event.
   */
  public evaluateTriage(options: TriageEvaluationOptions): TriageEvaluationResult {
    const culprits = options.culpritTaskIds ?? [];
    const activeTasks = options.activeTaskCount ?? culprits.length;

    // Check circuit breaker or repeated failure threshold
    if (this.isTripped() || this._failureCount >= this._maxFailures) {
      return {
        action: "block",
        event: LOOPER_EVENTS.EVT_TRIAGE_BLOCKED,
        targetState: LOOPER_STATES.STATE_ABORTED,
        circuitBreakerState: CIRCUIT_BREAKER_STATES.ESCALATED,
        failureCount: this._failureCount,
        culpritTaskIds: culprits,
        reason: `Victory audit failed repeatedly (${this._failureCount}/${this._maxFailures} attempts). Livelock prevention tripped circuit breaker to ESCALATED.`,
      };
    }

    // Check if regressions could be isolated into tasks
    if (culprits.length === 0 && activeTasks <= 0) {
      this.tripCircuitBreaker(
        "Triage could not isolate regression culprit tasks; unrecoverable systemic breakdown."
      );
      return {
        action: "block",
        event: LOOPER_EVENTS.EVT_TRIAGE_BLOCKED,
        targetState: LOOPER_STATES.STATE_ABORTED,
        circuitBreakerState: CIRCUIT_BREAKER_STATES.ESCALATED,
        failureCount: this._failureCount,
        culpritTaskIds: [],
        reason:
          "Triage failed to isolate regressions or activate DAG remediation tasks. Livelock prevention tripped circuit breaker to ESCALATED.",
      };
    }

    // Success: tasks are active and circuit breaker is closed
    return {
      action: "reopen",
      event: LOOPER_EVENTS.EVT_TRIAGE_REOPENED,
      targetState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
      circuitBreakerState: CIRCUIT_BREAKER_STATES.CLOSED,
      failureCount: this._failureCount,
      culpritTaskIds: culprits,
      reason: `Isolated ${culprits.length} culprit task(s) (${activeTasks} active in DAG). Returning to planning decomposition.`,
    };
  }

  /**
   * Returns recorded failure history.
   */
  public getHistory(): readonly VictoryAuditFailureRecord[] {
    return Object.freeze([...this._history]);
  }

  /**
   * Retrieves failure count for a specific task.
   */
  public getTaskFailureCount(taskId: string): number {
    return this._taskFailureCounts.get(taskId) ?? 0;
  }

  /**
   * Retrieves failure count for a specific module.
   */
  public getModuleFailureCount(moduleName: string): number {
    return this._moduleFailureCounts.get(moduleName) ?? 0;
  }

  /**
   * Resets all failure counters and returns circuit breaker to CLOSED.
   */
  public reset(): void {
    this._failureCount = 0;
    this._circuitBreakerState = CIRCUIT_BREAKER_STATES.CLOSED;
    this._taskFailureCounts.clear();
    this._moduleFailureCounts.clear();
    this._history.length = 0;
  }
}
