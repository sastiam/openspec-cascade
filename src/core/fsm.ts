/**
 * Event-Driven Finite State Machine (FSM) Lifecycle Engine.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 2.1 and 2.2.
 *
 * Provides a deterministic, strictly typed state machine orchestrating the looper lifecycle
 * through 18 states, validating transitions against the 39-rule transition matrix,
 * enforcing dynamic transition guards, and propagating execution context immutably.
 */

import { EventEmitter } from "node:events";
import {
  CIRCUIT_BREAKER_STATES,
  type CircuitBreakerState,
  FSM_ALLOWED_EVENTS,
  FSM_CONSTANTS,
  FSM_STATE_ADJACENCY,
  FSM_TRANSITION_MATRIX,
  FSM_TRANSITION_RULES,
  type FsmSnapshot,
  type FsmTransitionGuard,
  type FsmTransitionHook,
  type FsmTransitionPayload,
  type FsmTransitionRule,
  InvalidStateTransition,
  InvalidStateTransitionError,
  LOOPER_EVENTS,
  LOOPER_STATES,
  type LooperEvent,
  type LooperFsmContext,
  type LooperState,
  NON_TERMINAL_STATES,
  TERMINAL_STATES,
  type TerminalState,
  type NonTerminalState,
  canTransition,
  findTransitionRule,
  getAllowedEvents,
  getAllowedNextStates,
  isNonTerminalState,
  isTerminalState,
  isValidEvent,
  isValidNextState,
  isValidState,
} from "./fsm_types";
import {
  allTasksDoneGuard,
  createGate0ExhaustedGuard,
  createGate0RetryGuard,
  createGate1RejectGuard,
  createGate1ReviseGuard,
  createGate2BreakGuard,
  createGate2ExhaustedGuard,
  createSpawnLimitGuard,
  createStandardTransitionGuards,
  createVictoryTriageBlockedGuard,
  createVictoryTriageReopenedGuard,
  gate0PassFastTrackGuard,
  gate0PassFullGateGuard,
  planDecomposeAllTasksDoneGuard,
  planDecomposeExplorerGuard,
  planDecomposeWorkerGuard,
  type StandardGuardOptions,
  type TransitionGuardEntry,
} from "./fsm_guards";
import {
  type TriageEvaluationOptions,
  type TriageEvaluationResult,
  type VictoryAuditFailureRecord,
  type VictoryAuditLivelockOptions,
  VictoryAuditLivelockPrevention,
} from "./victory_livelock";

/**
 * Re-export all type definitions and constants from fsm_types, fsm_guards, and victory_livelock.
 */
export {
  CIRCUIT_BREAKER_STATES,
  FSM_ALLOWED_EVENTS,
  FSM_CONSTANTS,
  FSM_STATE_ADJACENCY,
  FSM_TRANSITION_MATRIX,
  FSM_TRANSITION_RULES,
  InvalidStateTransition,
  InvalidStateTransitionError,
  LOOPER_EVENTS,
  LOOPER_STATES,
  NON_TERMINAL_STATES,
  TERMINAL_STATES,
  VictoryAuditLivelockPrevention,
  allTasksDoneGuard,
  canTransition,
  createGate0ExhaustedGuard,
  createGate0RetryGuard,
  createGate1RejectGuard,
  createGate1ReviseGuard,
  createGate2BreakGuard,
  createGate2ExhaustedGuard,
  createSpawnLimitGuard,
  createStandardTransitionGuards,
  createVictoryTriageBlockedGuard,
  createVictoryTriageReopenedGuard,
  findTransitionRule,
  gate0PassFastTrackGuard,
  gate0PassFullGateGuard,
  getAllowedEvents,
  getAllowedNextStates,
  isNonTerminalState,
  isTerminalState,
  isValidEvent,
  isValidNextState,
  isValidState,
  planDecomposeAllTasksDoneGuard,
  planDecomposeExplorerGuard,
  planDecomposeWorkerGuard,
  type CircuitBreakerState,
  type FsmSnapshot,
  type FsmTransitionGuard,
  type FsmTransitionHook,
  type FsmTransitionPayload,
  type FsmTransitionRule,
  type LooperEvent,
  type LooperFsmContext,
  type LooperState,
  type NonTerminalState,
  type StandardGuardOptions,
  type TerminalState,
  type TransitionGuardEntry,
  type TriageEvaluationOptions,
  type TriageEvaluationResult,
  type VictoryAuditFailureRecord,
  type VictoryAuditLivelockOptions,
};

/**
 * Engine constants ensuring zero magic numbers throughout the lifecycle engine.
 */
export const FSM_ENGINE_CONSTANTS = {
  DEFAULT_MAX_HISTORY_ENTRIES: 100,
  DEFAULT_GATE0_ATTEMPTS: 0,
  DEFAULT_GATE1_ATTEMPTS: 0,
  DEFAULT_GATE2_ATTEMPTS: 0,
  DEFAULT_VICTORY_FAILURES: 0,
  DEFAULT_SPAWN_COUNT: 0,
  DEFAULT_TOKEN_UTILIZATION: 0,
  EVENT_TRANSITION: "transition",
  EVENT_TERMINAL: "terminal",
  EVENT_ERROR: "error",
  EVENT_GUARD_REJECTED: "guardRejected",
  EVENT_ENTER_PREFIX: "enter:",
  EVENT_EXIT_PREFIX: "exit:",
} as const;

/**
 * Specific error thrown when a transition guard rejects an FSM transition.
 * Extends InvalidStateTransitionError so existing error handling blocks catch it cleanly.
 */
export class TransitionGuardError extends InvalidStateTransitionError {
  readonly guardCondition: string;
  readonly failureReason?: string;

  constructor(
    fromState: LooperState,
    event: LooperEvent,
    targetRule: FsmTransitionRule,
    reason?: string
  ) {
    const detail = `Transition guard rejected transition from '${fromState}' to '${targetRule.toState}' on event '${event}'. Guard condition: "${targetRule.guardCondition}".${
      reason ? ` Reason: ${reason}` : ""
    }`;
    super(fromState, event, detail, targetRule.toState);
    this.name = "TransitionGuardError";
    this.guardCondition = targetRule.guardCondition;
    this.failureReason = reason;
  }
}

/**
 * Creates a default execution context with canonical zero values.
 */
export function createDefaultFsmContext(
  initial?: Partial<LooperFsmContext>
): LooperFsmContext {
  return {
    gate0Attempts: FSM_ENGINE_CONSTANTS.DEFAULT_GATE0_ATTEMPTS,
    gate1Attempts: FSM_ENGINE_CONSTANTS.DEFAULT_GATE1_ATTEMPTS,
    gate2Attempts: FSM_ENGINE_CONSTANTS.DEFAULT_GATE2_ATTEMPTS,
    victoryFailures: FSM_ENGINE_CONSTANTS.DEFAULT_VICTORY_FAILURES,
    spawnCount: FSM_ENGINE_CONSTANTS.DEFAULT_SPAWN_COUNT,
    tokenUtilizationPercent: FSM_ENGINE_CONSTANTS.DEFAULT_TOKEN_UTILIZATION,
    isFastTrack: false,
    hasActiveDagTasks: false,
    circuitBreakerState: CIRCUIT_BREAKER_STATES.CLOSED,
    metadata: {},
    ...initial,
  };
}

/**
 * Configuration options for initializing a LooperFSM engine instance.
 */
export interface LooperFsmOptions {
  readonly initialState?: LooperState;
  readonly initialContext?: Partial<LooperFsmContext>;
  readonly maxHistorySize?: number;
  readonly guards?: readonly FsmTransitionGuard[];
  readonly onTransition?: FsmTransitionHook;
  readonly enableStandardGuards?: boolean;
  readonly guardOptions?: StandardGuardOptions;
  readonly livelockPrevention?: VictoryAuditLivelockPrevention;
}

/**
 * Event-Driven Finite State Machine (FSM) Lifecycle Engine.
 *
 * Coordinates deterministic state transitions, dynamic guard checks, async/sync events,
 * and immutable context snapshots across the looper execution lifecycle.
 */
export class LooperFSM extends EventEmitter {
  private _currentState: LooperState;
  private _previousState: LooperState | null = null;
  private _lastEvent: LooperEvent | null = null;
  private _transitionCount = 0;
  private _context: LooperFsmContext;
  private _history: FsmTransitionPayload[] = [];
  private readonly _maxHistorySize: number;
  private readonly _globalGuards: Set<FsmTransitionGuard> = new Set();
  private readonly _ruleGuards: Map<string, Set<FsmTransitionGuard>> = new Map();
  private readonly _transitionHooks: Set<FsmTransitionHook> = new Set();
  private readonly _beforeTransitionHooks: Set<FsmTransitionHook> = new Set();
  private readonly _stateEnterHooks: Map<
    LooperState,
    Set<(payload: FsmTransitionPayload) => void | Promise<void>>
  > = new Map();
  private readonly _stateExitHooks: Map<
    LooperState,
    Set<(payload: FsmTransitionPayload) => void | Promise<void>>
  > = new Map();
  private readonly _livelockPrevention: VictoryAuditLivelockPrevention;
  private _isTransitioning = false;

  constructor(options?: LooperFsmOptions) {
    super();

    const initialState = options?.initialState ?? FSM_CONSTANTS.INITIAL_STATE;
    if (!isValidState(initialState)) {
      throw new InvalidStateTransitionError(
        initialState,
        "INITIALIZE",
        `Invalid initial state '${String(initialState)}' supplied to LooperFSM.`
      );
    }

    this._currentState = initialState;
    this._context = createDefaultFsmContext(options?.initialContext);
    this._maxHistorySize =
      options?.maxHistorySize ??
      FSM_ENGINE_CONSTANTS.DEFAULT_MAX_HISTORY_ENTRIES;

    this._livelockPrevention =
      options?.livelockPrevention ??
      new VictoryAuditLivelockPrevention({
        maxFailures:
          options?.guardOptions?.maxVictoryFailures ??
          FSM_CONSTANTS.MAX_VICTORY_AUDIT_FAILURES,
        initialCircuitBreakerState:
          this._context.circuitBreakerState ?? CIRCUIT_BREAKER_STATES.CLOSED,
      });

    if (options?.guards) {
      for (const guard of options.guards) {
        this.addGuard(guard);
      }
    }

    if (options?.enableStandardGuards) {
      this.registerStandardGuards(options.guardOptions);
    }

    if (options?.onTransition) {
      this.onTransition(options.onTransition);
    }
  }

  /**
   * Returns current active FSM state.
   */
  public getState(): LooperState {
    return this._currentState;
  }

  /**
   * Property getter for current active FSM state.
   */
  public get state(): LooperState {
    return this._currentState;
  }

  /**
   * Returns immediate previous FSM state, or null if no transition has occurred yet.
   */
  public getPreviousState(): LooperState | null {
    return this._previousState;
  }

  /**
   * Property getter for previous FSM state.
   */
  public get previousState(): LooperState | null {
    return this._previousState;
  }

  /**
   * Returns domain event that triggered the most recent transition, or null if initial.
   */
  public getLastEvent(): LooperEvent | null {
    return this._lastEvent;
  }

  /**
   * Property getter for domain event that triggered the most recent transition.
   */
  public get lastEvent(): LooperEvent | null {
    return this._lastEvent;
  }

  /**
   * Returns cumulative count of completed state transitions.
   */
  public getTransitionCount(): number {
    return this._transitionCount;
  }

  /**
   * Property getter for cumulative count of completed state transitions.
   */
  public get transitionCount(): number {
    return this._transitionCount;
  }

  /**
   * Returns true if current state is terminal (STATE_COMPLETED or STATE_ABORTED).
   */
  public isTerminal(): boolean {
    return isTerminalState(this._currentState);
  }

  /**
   * Returns true if current state is one of the 16 non-terminal operational states.
   */
  public isNonTerminal(): boolean {
    return isNonTerminalState(this._currentState);
  }

  /**
   * Returns Victory Audit livelock prevention and circuit breaker controller.
   */
  public get livelockPrevention(): VictoryAuditLivelockPrevention {
    return this._livelockPrevention;
  }

  /**
   * Returns current Victory Audit circuit breaker state ("CLOSED" | "ESCALATED").
   */
  public get circuitBreakerState(): CircuitBreakerState {
    return this._livelockPrevention.circuitBreakerState;
  }

  /**
   * Returns true if Victory Audit circuit breaker is tripped to ESCALATED.
   */
  public isCircuitBreakerTripped(): boolean {
    return this._livelockPrevention.isTripped();
  }

  /**
   * Checks whether the FSM is currently in the specified state.
   */
  public isState(state: LooperState): boolean {
    return this._currentState === state;
  }

  /**
   * Checks whether the FSM is currently in any of the specified candidate states.
   */
  public isInStates(states: readonly LooperState[]): boolean {
    return states.includes(this._currentState);
  }

  /**
   * Returns true if a state transition is currently being processed.
   */
  public isTransitioning(): boolean {
    return this._isTransitioning;
  }

  /**
   * Returns all domain events allowed to trigger out of current state.
   */
  public getAllowedEvents(): readonly LooperEvent[] {
    return getAllowedEvents(this._currentState);
  }

  /**
   * Returns all possible target states reachable from current state.
   */
  public getAllowedNextStates(): readonly LooperState[] {
    return getAllowedNextStates(this._currentState);
  }

  /**
   * Checks whether the specified event is declared as a valid trigger from current state.
   */
  public canTransition(event: LooperEvent): boolean {
    return canTransition(this._currentState, event);
  }

  /**
   * Alias for canTransition.
   */
  public can(event: LooperEvent): boolean {
    return this.canTransition(event);
  }

  /**
   * Checks whether direct transition to targetState is possible from current state.
   */
  public isValidNextState(targetState: LooperState): boolean {
    return isValidNextState(this._currentState, targetState);
  }

  /**
   * Retrieves declared transition rule for current state and specified event trigger.
   */
  public getTransitionRule(event: LooperEvent): FsmTransitionRule | undefined {
    return findTransitionRule(this._currentState, event);
  }

  /**
   * Returns an immutable read-only view of the current runtime context.
   */
  public getContext(): Readonly<LooperFsmContext> {
    return Object.freeze({ ...this._context });
  }

  /**
   * Property getter for current runtime context.
   */
  public get context(): Readonly<LooperFsmContext> {
    return this.getContext();
  }

  /**
   * Updates runtime context fields with shallow merge.
   */
  public updateContext(
    patch: Partial<LooperFsmContext>
  ): Readonly<LooperFsmContext> {
    this._context = {
      ...this._context,
      ...patch,
      ...(patch.metadata
        ? {
            metadata: {
              ...this._context.metadata,
              ...patch.metadata,
            },
          }
        : {}),
    };
    return this.getContext();
  }

  /**
   * Overwrites the complete runtime context.
   */
  public setContext(context: LooperFsmContext): void {
    this._context = { ...context };
  }

  /**
   * Resets runtime context to default zero values, optionally merging initial overrides.
   */
  public resetContext(initial?: Partial<LooperFsmContext>): void {
    this._context = createDefaultFsmContext(initial);
  }

  /**
   * Generates an immutable point-in-time snapshot of the engine state and statistics.
   */
  public getSnapshot(): FsmSnapshot {
    return Object.freeze({
      currentState: this._currentState,
      previousState: this._previousState,
      lastEvent: this._lastEvent,
      transitionCount: this._transitionCount,
      isTerminal: this.isTerminal(),
      context: this.getContext(),
    });
  }

  /**
   * Returns recorded transition history.
   */
  public getHistory(): readonly FsmTransitionPayload[] {
    return Object.freeze([...this._history]);
  }

  /**
   * Clears recorded transition history.
   */
  public clearHistory(): void {
    this._history = [];
  }

  /**
   * Registers a global transition guard evaluated before every transition.
   * Returns an unregister function.
   */
  public addGuard(guard: FsmTransitionGuard): () => void {
    this._globalGuards.add(guard);
    return (): void => {
      this._globalGuards.delete(guard);
    };
  }

  /**
   * Registers a specific transition guard for a given source state and event trigger.
   * Returns an unregister function.
   */
  public addTransitionGuard(
    fromState: LooperState,
    event: LooperEvent,
    guard: FsmTransitionGuard
  ): () => void {
    const key = this.getRuleGuardKey(fromState, event);
    let guards = this._ruleGuards.get(key);
    if (!guards) {
      guards = new Set();
      this._ruleGuards.set(key, guards);
    }
    guards.add(guard);
    return (): void => {
      const current = this._ruleGuards.get(key);
      if (current) {
        current.delete(guard);
        if (current.size === 0) {
          this._ruleGuards.delete(key);
        }
      }
    };
  }

  /**
   * Removes a global transition guard.
   */
  public removeGuard(guard: FsmTransitionGuard): boolean {
    return this._globalGuards.delete(guard);
  }

  /**
   * Clears all registered global and rule-specific guards.
   */
  public clearGuards(): void {
    this._globalGuards.clear();
    this._ruleGuards.clear();
  }

  /**
   * Registers all standard FSM transition guards conforming to the 16-state specification.
   * Returns a function to unregister all registered standard guards.
   */
  public registerStandardGuards(options?: StandardGuardOptions): () => void {
    const entries = createStandardTransitionGuards(options);
    const unregisters: Array<() => void> = [];

    for (const entry of entries) {
      unregisters.push(
        this.addTransitionGuard(entry.fromState, entry.event, entry.guard)
      );
    }

    return (): void => {
      for (const unreg of unregisters) {
        unreg();
      }
    };
  }

  /**
   * Subscribes a lifecycle hook invoked after every committed state transition.
   * Returns an unregister function.
   */
  public onTransition(hook: FsmTransitionHook): () => void {
    this._transitionHooks.add(hook);
    return (): void => {
      this._transitionHooks.delete(hook);
    };
  }

  /**
   * Subscribes a lifecycle hook invoked before a state transition is committed.
   * Returns an unregister function.
   */
  public beforeTransition(hook: FsmTransitionHook): () => void {
    this._beforeTransitionHooks.add(hook);
    return (): void => {
      this._beforeTransitionHooks.delete(hook);
    };
  }

  /**
   * Subscribes a hook invoked when entering a specific target state.
   * Returns an unregister function.
   */
  public onEnter(
    state: LooperState,
    hook: (payload: FsmTransitionPayload) => void | Promise<void>
  ): () => void {
    let hooks = this._stateEnterHooks.get(state);
    if (!hooks) {
      hooks = new Set();
      this._stateEnterHooks.set(state, hooks);
    }
    hooks.add(hook);
    return (): void => {
      const current = this._stateEnterHooks.get(state);
      if (current) {
        current.delete(hook);
      }
    };
  }

  /**
   * Subscribes a hook invoked when exiting a specific source state.
   * Returns an unregister function.
   */
  public onExit(
    state: LooperState,
    hook: (payload: FsmTransitionPayload) => void | Promise<void>
  ): () => void {
    let hooks = this._stateExitHooks.get(state);
    if (!hooks) {
      hooks = new Set();
      this._stateExitHooks.set(state, hooks);
    }
    hooks.add(hook);
    return (): void => {
      const current = this._stateExitHooks.get(state);
      if (current) {
        current.delete(hook);
      }
    };
  }

  /**
   * Resets the engine to a specified or default initial state.
   */
  public reset(
    initialState: LooperState = FSM_CONSTANTS.INITIAL_STATE,
    initialContext?: Partial<LooperFsmContext>
  ): void {
    if (!isValidState(initialState)) {
      throw new InvalidStateTransitionError(
        initialState,
        "RESET",
        `Invalid state '${String(initialState)}' supplied to reset.`
      );
    }
    this._currentState = initialState;
    this._previousState = null;
    this._lastEvent = null;
    this._transitionCount = 0;
    this._context = createDefaultFsmContext(initialContext);
    this._history = [];
    this._isTransitioning = false;
    this._livelockPrevention.reset();
  }

  /**
   * Evaluates triage recommendations without transitioning state.
   */
  public evaluateVictoryTriage(
    options: TriageEvaluationOptions
  ): TriageEvaluationResult {
    return this._livelockPrevention.evaluateTriage(options);
  }

  /**
   * Executes victory triage and dispatches recommended event (EVT_TRIAGE_REOPENED or EVT_TRIAGE_BLOCKED).
   */
  public async triageVictory(
    options: TriageEvaluationOptions
  ): Promise<LooperState> {
    const result = this._livelockPrevention.evaluateTriage(options);
    const hasActiveTasks =
      result.action === "reopen" &&
      (options.activeTaskCount !== undefined
        ? options.activeTaskCount > 0
        : result.culpritTaskIds.length > 0);

    return this.dispatch(result.event, {
      hasActiveDagTasks: hasActiveTasks,
      circuitBreakerState: result.circuitBreakerState,
      victoryFailures: result.failureCount,
      metadata: {
        triageAction: result.action,
        culpritTaskIds: result.culpritTaskIds,
        triageReason: result.reason,
      },
    });
  }

  /**
   * Synchronously executes victory triage and dispatches recommended event.
   */
  public triageVictorySync(options: TriageEvaluationOptions): LooperState {
    const result = this._livelockPrevention.evaluateTriage(options);
    const hasActiveTasks =
      result.action === "reopen" &&
      (options.activeTaskCount !== undefined
        ? options.activeTaskCount > 0
        : result.culpritTaskIds.length > 0);

    return this.dispatchSync(result.event, {
      hasActiveDagTasks: hasActiveTasks,
      circuitBreakerState: result.circuitBreakerState,
      victoryFailures: result.failureCount,
      metadata: {
        triageAction: result.action,
        culpritTaskIds: result.culpritTaskIds,
        triageReason: result.reason,
      },
    });
  }

  /**
   * Primary asynchronous state transition dispatcher.
   * Validates trigger event, evaluates dynamic guards, updates context,
   * emits lifecycle events, and returns the newly reached state.
   */
  public async dispatch(
    event: LooperEvent,
    contextPatch?: Partial<LooperFsmContext>
  ): Promise<LooperState> {
    const targetRule = this.validateTransitionPreconditions(event);

    if (this._isTransitioning) {
      throw new InvalidStateTransitionError(
        this._currentState,
        event,
        `Cannot dispatch '${event}' while a transition from '${this._currentState}' is already in progress.`
      );
    }

    this._isTransitioning = true;
    try {
      const candidateContext = this.createCandidateContext(contextPatch);

      // If victory audit fails, record failure and update livelock circuit breaker telemetry
      if (event === LOOPER_EVENTS.EVT_VICTORY_FAIL) {
        this._livelockPrevention.recordFailure({
          affectedModules: contextPatch?.metadata?.affectedModules as
            | readonly string[]
            | undefined,
          culpritTaskIds: contextPatch?.metadata?.culpritTaskIds as
            | readonly string[]
            | undefined,
          reason:
            (contextPatch?.metadata?.reason as string | undefined) ??
            (contextPatch?.metadata?.failureReason as string | undefined),
        });
        candidateContext.victoryFailures =
          this._livelockPrevention.failureCount;
        candidateContext.circuitBreakerState =
          this._livelockPrevention.circuitBreakerState;
      } else if (this._livelockPrevention.isTripped()) {
        candidateContext.circuitBreakerState = CIRCUIT_BREAKER_STATES.ESCALATED;
      }

      // Evaluate transition guards
      await this.evaluateGuardsAsync(event, targetRule, candidateContext);

      const payload: FsmTransitionPayload = {
        from: this._currentState,
        to: targetRule.toState,
        event,
        timestamp: Date.now(),
        context: Object.freeze({ ...candidateContext }),
      };

      // Execute beforeTransition hooks
      for (const hook of this._beforeTransitionHooks) {
        await hook(payload);
      }

      // Execute onExit hooks for current state
      const exitHooks = this._stateExitHooks.get(this._currentState);
      if (exitHooks) {
        for (const hook of exitHooks) {
          await hook(payload);
        }
      }

      // Commit transition state
      const sourceState = this._currentState;
      this._previousState = sourceState;
      this._currentState = targetRule.toState;
      this._lastEvent = event;
      this._context = candidateContext;
      this._transitionCount += 1;

      // Record in transition history buffer
      this.recordHistory(payload);

      // Emit standard EventEmitter events
      this.emit(FSM_ENGINE_CONSTANTS.EVENT_TRANSITION, payload);
      this.emit(
        `${FSM_ENGINE_CONSTANTS.EVENT_EXIT_PREFIX}${sourceState}`,
        payload
      );
      this.emit(
        `${FSM_ENGINE_CONSTANTS.EVENT_ENTER_PREFIX}${targetRule.toState}`,
        payload
      );

      if (isTerminalState(targetRule.toState)) {
        this.emit(FSM_ENGINE_CONSTANTS.EVENT_TERMINAL, payload);
      }

      // Execute onTransition hooks
      for (const hook of this._transitionHooks) {
        await hook(payload);
      }

      // Execute onEnter hooks for new state
      const enterHooks = this._stateEnterHooks.get(targetRule.toState);
      if (enterHooks) {
        for (const hook of enterHooks) {
          await hook(payload);
        }
      }

      return this._currentState;
    } catch (error) {
      this.handleDispatchError(error);
      throw error;
    } finally {
      this._isTransitioning = false;
    }
  }

  /**
   * Alias for dispatch().
   */
  public async transition(
    event: LooperEvent,
    contextPatch?: Partial<LooperFsmContext>
  ): Promise<LooperState> {
    return this.dispatch(event, contextPatch);
  }

  /**
   * Dispatches an event and returns an immutable FsmSnapshot of the resulting state.
   */
  public async dispatchWithSnapshot(
    event: LooperEvent,
    contextPatch?: Partial<LooperFsmContext>
  ): Promise<FsmSnapshot> {
    await this.dispatch(event, contextPatch);
    return this.getSnapshot();
  }

  /**
   * Synchronous state transition dispatcher for contexts requiring deterministic non-async flow.
   * Throws an error if any registered guard or hook returns a Promise.
   */
  public dispatchSync(
    event: LooperEvent,
    contextPatch?: Partial<LooperFsmContext>
  ): LooperState {
    const targetRule = this.validateTransitionPreconditions(event);

    if (this._isTransitioning) {
      throw new InvalidStateTransitionError(
        this._currentState,
        event,
        `Cannot dispatchSync '${event}' while a transition from '${this._currentState}' is already in progress.`
      );
    }

    this._isTransitioning = true;
    try {
      const candidateContext = this.createCandidateContext(contextPatch);

      // If victory audit fails, record failure and update livelock circuit breaker telemetry
      if (event === LOOPER_EVENTS.EVT_VICTORY_FAIL) {
        this._livelockPrevention.recordFailure({
          affectedModules: contextPatch?.metadata?.affectedModules as
            | readonly string[]
            | undefined,
          culpritTaskIds: contextPatch?.metadata?.culpritTaskIds as
            | readonly string[]
            | undefined,
          reason:
            (contextPatch?.metadata?.reason as string | undefined) ??
            (contextPatch?.metadata?.failureReason as string | undefined),
        });
        candidateContext.victoryFailures =
          this._livelockPrevention.failureCount;
        candidateContext.circuitBreakerState =
          this._livelockPrevention.circuitBreakerState;
      } else if (this._livelockPrevention.isTripped()) {
        candidateContext.circuitBreakerState = CIRCUIT_BREAKER_STATES.ESCALATED;
      }

      // Evaluate guards synchronously
      this.evaluateGuardsSync(event, targetRule, candidateContext);

      const payload: FsmTransitionPayload = {
        from: this._currentState,
        to: targetRule.toState,
        event,
        timestamp: Date.now(),
        context: Object.freeze({ ...candidateContext }),
      };

      // Execute beforeTransition hooks synchronously
      for (const hook of this._beforeTransitionHooks) {
        const result = hook(payload);
        if (result instanceof Promise) {
          throw new Error(
            "beforeTransition hook returned a Promise in dispatchSync. Use async dispatch() instead."
          );
        }
      }

      // Execute onExit hooks synchronously
      const exitHooks = this._stateExitHooks.get(this._currentState);
      if (exitHooks) {
        for (const hook of exitHooks) {
          const result = hook(payload);
          if (result instanceof Promise) {
            throw new Error(
              "onExit hook returned a Promise in dispatchSync. Use async dispatch() instead."
            );
          }
        }
      }

      // Commit transition state
      const sourceState = this._currentState;
      this._previousState = sourceState;
      this._currentState = targetRule.toState;
      this._lastEvent = event;
      this._context = candidateContext;
      this._transitionCount += 1;

      // Record in transition history buffer
      this.recordHistory(payload);

      // Emit standard EventEmitter events
      this.emit(FSM_ENGINE_CONSTANTS.EVENT_TRANSITION, payload);
      this.emit(
        `${FSM_ENGINE_CONSTANTS.EVENT_EXIT_PREFIX}${sourceState}`,
        payload
      );
      this.emit(
        `${FSM_ENGINE_CONSTANTS.EVENT_ENTER_PREFIX}${targetRule.toState}`,
        payload
      );

      if (isTerminalState(targetRule.toState)) {
        this.emit(FSM_ENGINE_CONSTANTS.EVENT_TERMINAL, payload);
      }

      // Execute onTransition hooks synchronously
      for (const hook of this._transitionHooks) {
        const result = hook(payload);
        if (result instanceof Promise) {
          throw new Error(
            "onTransition hook returned a Promise in dispatchSync. Use async dispatch() instead."
          );
        }
      }

      // Execute onEnter hooks synchronously
      const enterHooks = this._stateEnterHooks.get(targetRule.toState);
      if (enterHooks) {
        for (const hook of enterHooks) {
          const result = hook(payload);
          if (result instanceof Promise) {
            throw new Error(
              "onEnter hook returned a Promise in dispatchSync. Use async dispatch() instead."
            );
          }
        }
      }

      return this._currentState;
    } catch (error) {
      this.handleDispatchError(error);
      throw error;
    } finally {
      this._isTransitioning = false;
    }
  }

  /**
   * Synchronous alias for dispatchSync.
   */
  public transitionSync(
    event: LooperEvent,
    contextPatch?: Partial<LooperFsmContext>
  ): LooperState {
    return this.dispatchSync(event, contextPatch);
  }

  /**
   * Synchronously dispatches an event and returns an immutable snapshot.
   */
  public dispatchSyncWithSnapshot(
    event: LooperEvent,
    contextPatch?: Partial<LooperFsmContext>
  ): FsmSnapshot {
    this.dispatchSync(event, contextPatch);
    return this.getSnapshot();
  }

  /**
   * Internal validation verifying event validity, non-terminal state, and transition rule existence.
   */
  private validateTransitionPreconditions(
    event: LooperEvent
  ): FsmTransitionRule {
    if (!isValidEvent(event)) {
      throw new InvalidStateTransitionError(
        this._currentState,
        event,
        `Unrecognized domain event '${String(event)}'.`
      );
    }

    if (isTerminalState(this._currentState)) {
      throw new InvalidStateTransitionError(
        this._currentState,
        event,
        `Cannot transition from terminal state '${this._currentState}' on event '${event}'. Terminal states have zero outgoing transitions.`
      );
    }

    const rule = findTransitionRule(this._currentState, event);
    if (!rule) {
      const allowed = this.getAllowedEvents().join(", ");
      throw new InvalidStateTransitionError(
        this._currentState,
        event,
        `No valid transition declared from state '${this._currentState}' on event '${event}'. Allowed events: [${allowed}].`
      );
    }

    return rule;
  }

  /**
   * Constructs candidate context by merging contextPatch.
   */
  private createCandidateContext(
    contextPatch?: Partial<LooperFsmContext>
  ): LooperFsmContext {
    if (!contextPatch) {
      return { ...this._context };
    }
    return {
      ...this._context,
      ...contextPatch,
      ...(contextPatch.metadata
        ? {
            metadata: {
              ...this._context.metadata,
              ...contextPatch.metadata,
            },
          }
        : {}),
    };
  }

  /**
   * Evaluates all applicable guards asynchronously.
   */
  private async evaluateGuardsAsync(
    event: LooperEvent,
    rule: FsmTransitionRule,
    candidateContext: LooperFsmContext
  ): Promise<void> {
    const guards = this.collectGuards(rule);

    for (const guard of guards) {
      const allowed = await guard(candidateContext, event, rule);
      if (!allowed) {
        this.emit(FSM_ENGINE_CONSTANTS.EVENT_GUARD_REJECTED, {
          from: this._currentState,
          to: rule.toState,
          event,
          guardCondition: rule.guardCondition,
        });
        throw new TransitionGuardError(this._currentState, event, rule);
      }
    }
  }

  /**
   * Evaluates all applicable guards synchronously.
   */
  private evaluateGuardsSync(
    event: LooperEvent,
    rule: FsmTransitionRule,
    candidateContext: LooperFsmContext
  ): void {
    const guards = this.collectGuards(rule);

    for (const guard of guards) {
      const allowed = guard(candidateContext, event, rule);
      if (allowed instanceof Promise) {
        throw new Error(
          "Transition guard returned a Promise during dispatchSync. Use async dispatch() instead."
        );
      }
      if (!allowed) {
        this.emit(FSM_ENGINE_CONSTANTS.EVENT_GUARD_REJECTED, {
          from: this._currentState,
          to: rule.toState,
          event,
          guardCondition: rule.guardCondition,
        });
        throw new TransitionGuardError(this._currentState, event, rule);
      }
    }
  }

  /**
   * Aggregates global and rule-specific guards.
   */
  private collectGuards(rule: FsmTransitionRule): FsmTransitionGuard[] {
    const guards: FsmTransitionGuard[] = [];

    // Global guards
    for (const g of this._globalGuards) {
      guards.push(g);
    }

    // Rule-specific guards
    const key = this.getRuleGuardKey(rule.fromState, rule.event);
    const ruleGuards = this._ruleGuards.get(key);
    if (ruleGuards) {
      for (const g of ruleGuards) {
        guards.push(g);
      }
    }

    return guards;
  }

  /**
   * Appends transition payload to history buffer with capacity cap.
   */
  private recordHistory(payload: FsmTransitionPayload): void {
    this._history.push(payload);
    if (this._history.length > this._maxHistorySize) {
      this._history.shift();
    }
  }

  /**
   * Handles dispatch errors by emitting to error listeners if present.
   */
  private handleDispatchError(error: unknown): void {
    if (this.listenerCount(FSM_ENGINE_CONSTANTS.EVENT_ERROR) > 0) {
      this.emit(FSM_ENGINE_CONSTANTS.EVENT_ERROR, error);
    }
  }

  /**
   * Formats key for rule-specific guard registry.
   */
  private getRuleGuardKey(fromState: LooperState, event: LooperEvent): string {
    return `${fromState}:${event}`;
  }
}
