import { describe, expect, it } from "bun:test";
import {
  CIRCUIT_BREAKER_STATES,
  FSM_CONSTANTS,
  FSM_ENGINE_CONSTANTS,
  InvalidStateTransition,
  InvalidStateTransitionError,
  LOOPER_EVENTS,
  LOOPER_STATES,
  LooperFSM,
  TransitionGuardError,
  createDefaultFsmContext,
  type FsmSnapshot,
  type FsmTransitionPayload,
  type LooperEvent,
  type LooperState,
} from "../../src/core/fsm";

describe("LooperFSM Lifecycle Engine", () => {
  describe("Initialization & State Accessors", () => {
    it("initializes in STATE_INIT with default context and zero transitions", () => {
      const fsm = new LooperFSM();

      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_INIT);
      expect(fsm.state).toBe(LOOPER_STATES.STATE_INIT);
      expect(fsm.getPreviousState()).toBeNull();
      expect(fsm.previousState).toBeNull();
      expect(fsm.getLastEvent()).toBeNull();
      expect(fsm.lastEvent).toBeNull();
      expect(fsm.getTransitionCount()).toBe(0);
      expect(fsm.transitionCount).toBe(0);
      expect(fsm.isTerminal()).toBe(false);
      expect(fsm.isNonTerminal()).toBe(true);
      expect(fsm.isTransitioning()).toBe(false);
      expect(fsm.isCircuitBreakerTripped()).toBe(false);
      expect(fsm.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(fsm.getHistory().length).toBe(0);
    });

    it("initializes with custom state and initial context", () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        initialContext: {
          gate0Attempts: 1,
          isFastTrack: true,
          metadata: { initialSource: "test" },
        },
      });

      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
      expect(fsm.context.gate0Attempts).toBe(1);
      expect(fsm.context.isFastTrack).toBe(true);
      expect(fsm.context.metadata?.initialSource).toBe("test");
    });

    it("rejects invalid initial state with InvalidStateTransitionError", () => {
      expect(() => {
        new LooperFSM({
          initialState: "INVALID_STATE" as LooperState,
        });
      }).toThrow(InvalidStateTransitionError);
    });

    it("provides accurate state matching helpers", () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_DISPATCH_WORKER,
      });

      expect(fsm.isState(LOOPER_STATES.STATE_DISPATCH_WORKER)).toBe(true);
      expect(fsm.isState(LOOPER_STATES.STATE_INIT)).toBe(false);
      expect(
        fsm.isInStates([
          LOOPER_STATES.STATE_INIT,
          LOOPER_STATES.STATE_DISPATCH_WORKER,
        ])
      ).toBe(true);
      expect(
        fsm.isInStates([
          LOOPER_STATES.STATE_GATE_0_AUTO,
          LOOPER_STATES.STATE_GATE_1_REVIEW,
        ])
      ).toBe(false);
    });

    it("identifies terminal states correctly", () => {
      const completedFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_COMPLETED,
      });
      expect(completedFsm.isTerminal()).toBe(true);
      expect(completedFsm.isNonTerminal()).toBe(false);

      const abortedFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_ABORTED,
      });
      expect(abortedFsm.isTerminal()).toBe(true);
      expect(abortedFsm.isNonTerminal()).toBe(false);
    });

    it("provides accurate event and transition rule lookup helpers", () => {
      const fsm = new LooperFSM({ initialState: LOOPER_STATES.STATE_INIT });

      const allowedEvents = fsm.getAllowedEvents();
      expect(allowedEvents).toEqual([
        LOOPER_EVENTS.EVT_INIT_SUCCESS,
        LOOPER_EVENTS.EVT_FATAL_ERROR,
      ]);

      const allowedNextStates = fsm.getAllowedNextStates();
      expect(allowedNextStates).toEqual([
        LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        LOOPER_STATES.STATE_ABORTED,
      ]);

      expect(fsm.canTransition(LOOPER_EVENTS.EVT_INIT_SUCCESS)).toBe(true);
      expect(fsm.can(LOOPER_EVENTS.EVT_INIT_SUCCESS)).toBe(true);
      expect(fsm.canTransition(LOOPER_EVENTS.EVT_WORK_SUBMITTED)).toBe(false);

      expect(
        fsm.isValidNextState(LOOPER_STATES.STATE_PLAN_DECOMPOSE)
      ).toBe(true);
      expect(
        fsm.isValidNextState(LOOPER_STATES.STATE_GATE_0_AUTO)
      ).toBe(false);

      const rule = fsm.getTransitionRule(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      expect(rule).toBeDefined();
      expect(rule?.toState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
      expect(fsm.getTransitionRule(LOOPER_EVENTS.EVT_WORK_SUBMITTED)).toBeUndefined();
    });
  });

  describe("Context & Snapshot Management", () => {
    it("returns frozen context and supports updates with metadata merge", () => {
      const fsm = new LooperFSM();

      const initialCtx = fsm.getContext();
      expect(Object.isFrozen(initialCtx)).toBe(true);

      const updated = fsm.updateContext({
        gate0Attempts: 2,
        metadata: { key1: "value1" },
      });

      expect(updated.gate0Attempts).toBe(2);
      expect(updated.metadata?.key1).toBe("value1");

      fsm.updateContext({
        metadata: { key2: "value2" },
      });

      expect(fsm.context.metadata?.key1).toBe("value1");
      expect(fsm.context.metadata?.key2).toBe("value2");
    });

    it("replaces context with setContext and resets with resetContext", () => {
      const fsm = new LooperFSM();
      const customCtx = createDefaultFsmContext({
        gate0Attempts: 5,
        isFastTrack: true,
      });

      fsm.setContext(customCtx);
      expect(fsm.context.gate0Attempts).toBe(5);
      expect(fsm.context.isFastTrack).toBe(true);

      fsm.resetContext({ spawnCount: 1 });
      expect(fsm.context.gate0Attempts).toBe(0);
      expect(fsm.context.spawnCount).toBe(1);
    });

    it("generates immutable snapshots matching engine state", () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        initialContext: { gate0Attempts: 1 },
      });

      const snapshot: FsmSnapshot = fsm.getSnapshot();
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(snapshot.currentState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
      expect(snapshot.previousState).toBeNull();
      expect(snapshot.lastEvent).toBeNull();
      expect(snapshot.transitionCount).toBe(0);
      expect(snapshot.isTerminal).toBe(false);
      expect(snapshot.context.gate0Attempts).toBe(1);
    });

    it("supports dispatchWithSnapshot and dispatchSyncWithSnapshot", async () => {
      const fsm = new LooperFSM();

      const asyncSnapshot = await fsm.dispatchWithSnapshot(
        LOOPER_EVENTS.EVT_INIT_SUCCESS,
        { taskRole: "worker" }
      );
      expect(asyncSnapshot.currentState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
      expect(asyncSnapshot.previousState).toBe(LOOPER_STATES.STATE_INIT);
      expect(asyncSnapshot.lastEvent).toBe(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      expect(asyncSnapshot.transitionCount).toBe(1);
      expect(asyncSnapshot.context.taskRole).toBe("worker");

      const syncSnapshot = fsm.dispatchSyncWithSnapshot(
        LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER
      );
      expect(syncSnapshot.currentState).toBe(LOOPER_STATES.STATE_DISPATCH_WORKER);
      expect(syncSnapshot.previousState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
      expect(syncSnapshot.lastEvent).toBe(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER);
      expect(syncSnapshot.transitionCount).toBe(2);
    });
  });

  describe("Deterministic FSM Execution & Illegal Transition Rejection (Spec Requirements)", () => {
    it("transitions only across declared valid state edges", async () => {
      const fsm = new LooperFSM();

      const nextState = await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      expect(nextState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
      expect(fsm.previousState).toBe(LOOPER_STATES.STATE_INIT);
      expect(fsm.lastEvent).toBe(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      expect(fsm.transitionCount).toBe(1);
    });

    it("Scenario: An illegal event is dispatched - rejects transition and raises InvalidStateTransition error", async () => {
      const fsm = new LooperFSM({ initialState: LOOPER_STATES.STATE_INIT });

      // Dispatched event is not valid from STATE_INIT
      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED)
      ).rejects.toThrow(InvalidStateTransitionError);

      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED)
      ).rejects.toBeInstanceOf(InvalidStateTransition);

      // Current state remains unchanged after rejected transition
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_INIT);
      expect(fsm.getTransitionCount()).toBe(0);

      // Rejects completely invalid/unknown domain event
      await expect(
        fsm.dispatch("UNKNOWN_EVENT" as LooperEvent)
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it("rejects transitions from terminal states with zero outgoing edges", async () => {
      const completedFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_COMPLETED,
      });

      await expect(
        completedFsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS)
      ).rejects.toThrow(InvalidStateTransitionError);

      const abortedFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_ABORTED,
      });

      await expect(
        abortedFsm.dispatch(LOOPER_EVENTS.EVT_FATAL_ERROR)
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it("prevents concurrent transitions when dispatch is already in progress", async () => {
      const fsm = new LooperFSM();

      let resolveHook: () => void;
      const hookPromise = new Promise<void>((resolve) => {
        resolveHook = resolve;
      });

      fsm.beforeTransition(async () => {
        await hookPromise;
      });

      const firstTransition = fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);

      // While first dispatch is pending, second dispatch must throw
      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_FATAL_ERROR)
      ).rejects.toThrow(InvalidStateTransitionError);

      resolveHook!();
      await firstTransition;
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
    });
  });

  describe("Custom Transition Guards & Error Taxonomy", () => {
    it("evaluates global guard and throws TransitionGuardError on rejection", async () => {
      const fsm = new LooperFSM({ initialState: LOOPER_STATES.STATE_INIT });

      // Guard blocks transition if context.metadata.blocked is true
      const unregister = fsm.addGuard((context) => {
        return !context.metadata?.blocked;
      });

      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS, {
          metadata: { blocked: true },
        })
      ).rejects.toThrow(TransitionGuardError);

      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_INIT);

      // Unregister guard and verify transition succeeds
      unregister();
      const state = await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS, {
        metadata: { blocked: true },
      });
      expect(state).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);
    });

    it("evaluates rule-specific guard and emits guardRejected event", async () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
      });

      let guardRejectedPayload: unknown = null;
      fsm.on("guardRejected", (payload) => {
        guardRejectedPayload = payload;
      });

      fsm.addTransitionGuard(
        LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER,
        (context) => context.taskRole === "worker"
      );

      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, {
          taskRole: "explorer",
        })
      ).rejects.toThrow(TransitionGuardError);

      expect(guardRejectedPayload).not.toBeNull();
      expect((guardRejectedPayload as { from: LooperState }).from).toBe(
        LOOPER_STATES.STATE_PLAN_DECOMPOSE
      );
      expect((guardRejectedPayload as { event: LooperEvent }).event).toBe(
        LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER
      );
    });

    it("supports removeGuard and clearGuards", async () => {
      const fsm = new LooperFSM();

      const failingGuard = () => false;
      fsm.addGuard(failingGuard);

      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS)
      ).rejects.toThrow(TransitionGuardError);

      const removed = fsm.removeGuard(failingGuard);
      expect(removed).toBe(true);

      const state = await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      expect(state).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      fsm.addGuard(() => false);
      fsm.clearGuards();

      const workerState = await fsm.dispatch(
        LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER
      );
      expect(workerState).toBe(LOOPER_STATES.STATE_DISPATCH_WORKER);
    });
  });

  describe("Lifecycle Event Emitters & Hooks", () => {
    it("emits transition, exit, enter, and terminal events in order", async () => {
      const fsm = new LooperFSM();
      const eventLog: string[] = [];

      fsm.on(FSM_ENGINE_CONSTANTS.EVENT_TRANSITION, (payload: FsmTransitionPayload) => {
        eventLog.push(`transition:${payload.from}->${payload.to}`);
      });

      fsm.on("exit:STATE_INIT", () => {
        eventLog.push("exit:STATE_INIT");
      });

      fsm.on("enter:STATE_ABORTED", () => {
        eventLog.push("enter:STATE_ABORTED");
      });

      fsm.on(FSM_ENGINE_CONSTANTS.EVENT_TERMINAL, (payload: FsmTransitionPayload) => {
        eventLog.push(`terminal:${payload.to}`);
      });

      await fsm.dispatch(LOOPER_EVENTS.EVT_FATAL_ERROR);

      expect(eventLog).toEqual([
        "transition:STATE_INIT->STATE_ABORTED",
        "exit:STATE_INIT",
        "enter:STATE_ABORTED",
        "terminal:STATE_ABORTED",
      ]);
      expect(fsm.isTerminal()).toBe(true);
    });

    it("executes beforeTransition and onTransition lifecycle hooks", async () => {
      const fsm = new LooperFSM();
      const hookLog: string[] = [];

      const unregBefore = fsm.beforeTransition((payload) => {
        hookLog.push(`before:${payload.from}->${payload.to}`);
      });

      const unregAfter = fsm.onTransition((payload) => {
        hookLog.push(`after:${payload.from}->${payload.to}`);
      });

      await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      expect(hookLog).toEqual([
        "before:STATE_INIT->STATE_PLAN_DECOMPOSE",
        "after:STATE_INIT->STATE_PLAN_DECOMPOSE",
      ]);

      unregBefore();
      unregAfter();

      await fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER);
      expect(hookLog.length).toBe(2);
    });

    it("executes state-specific onEnter and onExit hooks", async () => {
      const fsm = new LooperFSM();
      const stateLog: string[] = [];

      const unregExit = fsm.onExit(LOOPER_STATES.STATE_INIT, () => {
        stateLog.push("exit:STATE_INIT");
      });

      const unregEnter = fsm.onEnter(
        LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        () => {
          stateLog.push("enter:STATE_PLAN_DECOMPOSE");
        }
      );

      await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      expect(stateLog).toEqual([
        "exit:STATE_INIT",
        "enter:STATE_PLAN_DECOMPOSE",
      ]);

      unregExit();
      unregEnter();
    });

    it("emits error event when error listener is registered", async () => {
      const fsm = new LooperFSM();
      let capturedError: unknown = null;

      fsm.on(FSM_ENGINE_CONSTANTS.EVENT_ERROR, (err) => {
        capturedError = err;
      });

      fsm.addGuard(() => false);

      try {
        await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      } catch {
        // Expected throw
      }

      expect(capturedError).toBeInstanceOf(TransitionGuardError);
    });
  });

  describe("Synchronous Dispatch (dispatchSync & transitionSync)", () => {
    it("executes synchronous transitions cleanly", () => {
      const fsm = new LooperFSM();

      const s1 = fsm.dispatchSync(LOOPER_EVENTS.EVT_INIT_SUCCESS, {
        taskRole: "worker",
      });
      expect(s1).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      const s2 = fsm.transitionSync(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER);
      expect(s2).toBe(LOOPER_STATES.STATE_DISPATCH_WORKER);
      expect(fsm.getTransitionCount()).toBe(2);
    });

    it("throws error if a hook returns a Promise during dispatchSync", () => {
      const fsm = new LooperFSM();
      fsm.beforeTransition(async () => {
        // Async hook
      });

      expect(() => {
        fsm.dispatchSync(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      }).toThrow("beforeTransition hook returned a Promise in dispatchSync");
    });

    it("throws error if a guard returns a Promise during dispatchSync", () => {
      const fsm = new LooperFSM();
      fsm.addGuard(async () => true);

      expect(() => {
        fsm.dispatchSync(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      }).toThrow("Transition guard returned a Promise during dispatchSync");
    });
  });

  describe("End-to-End Operational Lifecycle Trajectories", () => {
    it("executes complete Happy Path trajectory from STATE_INIT to STATE_COMPLETED", async () => {
      const fsm = new LooperFSM({ enableStandardGuards: true });

      // 1. STATE_INIT -> STATE_PLAN_DECOMPOSE
      await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      // 2. STATE_PLAN_DECOMPOSE -> STATE_DISPATCH_WORKER
      await fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, {
        taskRole: "worker",
        hasActiveDagTasks: true,
      });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_DISPATCH_WORKER);

      // 3. STATE_DISPATCH_WORKER -> STATE_EXECUTE_WORKER
      await fsm.dispatch(LOOPER_EVENTS.EVT_WORKER_SPAWNED);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);

      // 4. STATE_EXECUTE_WORKER -> STATE_GATE_0_AUTO
      await fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_GATE_0_AUTO);

      // 5. STATE_GATE_0_AUTO -> STATE_GATE_1_REVIEW (Full Gate Policy)
      await fsm.dispatch(LOOPER_EVENTS.EVT_G0_PASS, { isFastTrack: false });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_GATE_1_REVIEW);

      // 6. STATE_GATE_1_REVIEW -> STATE_GATE_2_CHALLENGE
      await fsm.dispatch(LOOPER_EVENTS.EVT_G1_PASS);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_GATE_2_CHALLENGE);

      // 7. STATE_GATE_2_CHALLENGE -> STATE_GATE_3_AUDIT
      await fsm.dispatch(LOOPER_EVENTS.EVT_G2_PASS);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);

      // 8. STATE_GATE_3_AUDIT -> STATE_COMMIT_CHECKPOINT
      await fsm.dispatch(LOOPER_EVENTS.EVT_G3_PASS);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_COMMIT_CHECKPOINT);

      // 9. STATE_COMMIT_CHECKPOINT -> STATE_PLAN_DECOMPOSE
      await fsm.dispatch(LOOPER_EVENTS.EVT_CHECKPOINT_COMMITTED);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      // 10. STATE_PLAN_DECOMPOSE -> STATE_VICTORY_AUDIT
      await fsm.dispatch(LOOPER_EVENTS.EVT_ALL_TASKS_DONE, {
        hasActiveDagTasks: false,
      });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_VICTORY_AUDIT);

      // 11. STATE_VICTORY_AUDIT -> STATE_COMPLETED
      await fsm.dispatch(LOOPER_EVENTS.EVT_VICTORY_PASS);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_COMPLETED);
      expect(fsm.isTerminal()).toBe(true);
      expect(fsm.getTransitionCount()).toBe(11);
    });

    it("executes Fast-Track trajectory bypassing Gates 1 and 2", async () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_GATE_0_AUTO,
        enableStandardGuards: true,
      });

      // Fast-Track bypasses Gate 1 and Gate 2 straight to Gate 3 Audit
      await fsm.dispatch(LOOPER_EVENTS.EVT_G0_PASS_FAST_TRACK, {
        isFastTrack: true,
      });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);

      await fsm.dispatch(LOOPER_EVENTS.EVT_G3_PASS);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_COMMIT_CHECKPOINT);
    });

    it("executes Explorer trajectory to survey codebase", async () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        enableStandardGuards: true,
      });

      await fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_EXPLORER, {
        taskRole: "explorer",
      });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_DISPATCH_EXPLORER);

      await fsm.dispatch(LOOPER_EVENTS.EVT_EXPLORER_SPAWNED);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_EXECUTE_EXPLORER);

      await fsm.dispatch(LOOPER_EVENTS.EVT_EXPLORATION_COMPLETE);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_GATE_3_AUDIT);
    });

    it("executes Gate retry loops (Gate 0 retry, Gate 1 revise, Gate 2 break)", async () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_GATE_0_AUTO,
        enableStandardGuards: true,
      });

      // Gate 0 retry: returns to EXECUTE_WORKER
      await fsm.dispatch(LOOPER_EVENTS.EVT_G0_RETRY, { gate0Attempts: 0 });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);

      await fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED);
      await fsm.dispatch(LOOPER_EVENTS.EVT_G0_PASS, { isFastTrack: false });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_GATE_1_REVIEW);

      // Gate 1 revise: returns to EXECUTE_WORKER
      await fsm.dispatch(LOOPER_EVENTS.EVT_G1_REVISE, { gate1Attempts: 1 });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);

      await fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED);
      await fsm.dispatch(LOOPER_EVENTS.EVT_G0_PASS, { isFastTrack: false });
      await fsm.dispatch(LOOPER_EVENTS.EVT_G1_PASS);
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_GATE_2_CHALLENGE);

      // Gate 2 break: returns to EXECUTE_WORKER
      await fsm.dispatch(LOOPER_EVENTS.EVT_G2_BREAK, { gate2Attempts: 0 });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);
    });

    it("executes Escalation & Rollback Recovery trajectories", async () => {
      // 1. Gate 0 Exhausted -> ESCALATE_DIAGNOSTIC -> Diagnostic Retry -> EXECUTE_WORKER
      const diagFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_GATE_0_AUTO,
        enableStandardGuards: true,
      });

      await diagFsm.dispatch(LOOPER_EVENTS.EVT_G0_EXHAUSTED, {
        gate0Attempts: FSM_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
      });
      expect(diagFsm.getState()).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);

      await diagFsm.dispatch(LOOPER_EVENTS.EVT_DIAGNOSTIC_RETRY);
      expect(diagFsm.getState()).toBe(LOOPER_STATES.STATE_EXECUTE_WORKER);

      // 2. ESCALATE_DIAGNOSTIC -> ROLLBACK_RECOVERY -> DISPATCH_WORKER (Resolved)
      const rollbackFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
      });
      await rollbackFsm.dispatch(LOOPER_EVENTS.EVT_ROLLBACK_REQUIRED);
      expect(rollbackFsm.getState()).toBe(LOOPER_STATES.STATE_ROLLBACK_RECOVERY);

      await rollbackFsm.dispatch(LOOPER_EVENTS.EVT_ESCALATION_RESOLVED);
      expect(rollbackFsm.getState()).toBe(LOOPER_STATES.STATE_DISPATCH_WORKER);

      // 3. ROLLBACK_RECOVERY -> PLAN_DECOMPOSE (Redecompose compound task)
      const redecomposeFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_ROLLBACK_RECOVERY,
      });
      await redecomposeFsm.dispatch(LOOPER_EVENTS.EVT_REDECOMPOSE_REQUIRED);
      expect(redecomposeFsm.getState()).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      // 4. ROLLBACK_RECOVERY -> ABORTED (Escalation failed)
      const failedFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_ROLLBACK_RECOVERY,
      });
      await failedFsm.dispatch(LOOPER_EVENTS.EVT_ESCALATION_FAILED);
      expect(failedFsm.getState()).toBe(LOOPER_STATES.STATE_ABORTED);
      expect(failedFsm.isTerminal()).toBe(true);

      // 5. ESCALATE_DIAGNOSTIC -> ABORTED (Escalation fatal)
      const fatalDiagFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC,
      });
      await fatalDiagFsm.dispatch(LOOPER_EVENTS.EVT_ESCALATION_FATAL);
      expect(fatalDiagFsm.getState()).toBe(LOOPER_STATES.STATE_ABORTED);
    });

    it("executes Explorer failure routes and Worker timeout escalation", async () => {
      // Explorer spawn failed
      const expSpawnFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_DISPATCH_EXPLORER,
      });
      await expSpawnFsm.dispatch(LOOPER_EVENTS.EVT_SPAWN_FAILED);
      expect(expSpawnFsm.getState()).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);

      // Explorer timeout
      const expTimeoutFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_EXECUTE_EXPLORER,
      });
      await expTimeoutFsm.dispatch(LOOPER_EVENTS.EVT_EXPLORER_TIMEOUT);
      expect(expTimeoutFsm.getState()).toBe(
        LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC
      );

      // Worker timeout
      const workerTimeoutFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_EXECUTE_WORKER,
      });
      await workerTimeoutFsm.dispatch(LOOPER_EVENTS.EVT_WORKER_TIMEOUT);
      expect(workerTimeoutFsm.getState()).toBe(
        LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC
      );

      // Worker spawn failed routes to ROLLBACK_RECOVERY
      const workerSpawnFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_DISPATCH_WORKER,
      });
      await workerSpawnFsm.dispatch(LOOPER_EVENTS.EVT_SPAWN_FAILED);
      expect(workerSpawnFsm.getState()).toBe(
        LOOPER_STATES.STATE_ROLLBACK_RECOVERY
      );
    });

    it("executes Gate 1 reject, Gate 2 exhausted, and Gate 3 veto escalation", async () => {
      // Gate 1 reject
      const g1Fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_GATE_1_REVIEW,
        enableStandardGuards: true,
      });
      await g1Fsm.dispatch(LOOPER_EVENTS.EVT_G1_REJECT, {
        gate1Attempts: FSM_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
      });
      expect(g1Fsm.getState()).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);

      // Gate 2 exhausted
      const g2Fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_GATE_2_CHALLENGE,
        enableStandardGuards: true,
      });
      await g2Fsm.dispatch(LOOPER_EVENTS.EVT_G2_EXHAUSTED, {
        gate2Attempts: FSM_CONSTANTS.DEFAULT_MAX_CHALLENGE_ATTEMPTS,
      });
      expect(g2Fsm.getState()).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);

      // Gate 3 veto
      const g3Fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_GATE_3_AUDIT,
      });
      await g3Fsm.dispatch(LOOPER_EVENTS.EVT_G3_VETO);
      expect(g3Fsm.getState()).toBe(LOOPER_STATES.STATE_ESCALATE_DIAGNOSTIC);
    });

    it("executes succession transitions at task boundaries", async () => {
      // From PLAN_DECOMPOSE
      const planFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_PLAN_DECOMPOSE,
        enableStandardGuards: true,
      });
      await planFsm.dispatch(LOOPER_EVENTS.EVT_SPAWN_LIMIT, {
        spawnCount: FSM_CONSTANTS.DEFAULT_SPAWN_LIMIT,
      });
      expect(planFsm.getState()).toBe(LOOPER_STATES.STATE_SUCCESSION);

      await planFsm.dispatch(LOOPER_EVENTS.EVT_SUCCESSION_COMPLETE);
      expect(planFsm.getState()).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      // From COMMIT_CHECKPOINT
      const commitFsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_COMMIT_CHECKPOINT,
        enableStandardGuards: true,
      });
      await commitFsm.dispatch(LOOPER_EVENTS.EVT_SPAWN_LIMIT, {
        spawnCount: FSM_CONSTANTS.DEFAULT_SPAWN_LIMIT,
      });
      expect(commitFsm.getState()).toBe(LOOPER_STATES.STATE_SUCCESSION);
    });
  });

  describe("Victory Audit Livelock Prevention & Circuit Breaker (Spec Scenario)", () => {
    it("Scenario: Victory audit fails repeatedly - trips circuit breaker to ESCALATED and halts execution", async () => {
      const fsm = new LooperFSM({
        initialState: LOOPER_STATES.STATE_VICTORY_AUDIT,
        enableStandardGuards: true,
      });

      expect(fsm.isCircuitBreakerTripped()).toBe(false);
      expect(fsm.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);

      // --- FIRST FAILURE ---
      const triage1 = await fsm.dispatch(LOOPER_EVENTS.EVT_VICTORY_FAIL, {
        metadata: {
          affectedModules: ["src/core"],
          culpritTaskIds: ["task-1.1"],
          reason: "Integration regression on first run",
        },
      });
      expect(triage1).toBe(LOOPER_STATES.STATE_VICTORY_TRIAGE);
      expect(fsm.livelockPrevention.failureCount).toBe(1);
      expect(fsm.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
      expect(fsm.isCircuitBreakerTripped()).toBe(false);

      // Re-open culprit task in triage
      const planState = await fsm.triageVictory({
        culpritTaskIds: ["task-1.1"],
        activeTaskCount: 1,
      });
      expect(planState).toBe(LOOPER_STATES.STATE_PLAN_DECOMPOSE);

      // Resolve DAG task and return to victory audit
      await fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, {
        taskRole: "worker",
      });
      await fsm.dispatch(LOOPER_EVENTS.EVT_WORKER_SPAWNED);
      await fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED);
      await fsm.dispatch(LOOPER_EVENTS.EVT_G0_PASS, { isFastTrack: false });
      await fsm.dispatch(LOOPER_EVENTS.EVT_G1_PASS);
      await fsm.dispatch(LOOPER_EVENTS.EVT_G2_PASS);
      await fsm.dispatch(LOOPER_EVENTS.EVT_G3_PASS);
      await fsm.dispatch(LOOPER_EVENTS.EVT_CHECKPOINT_COMMITTED);
      await fsm.dispatch(LOOPER_EVENTS.EVT_ALL_TASKS_DONE, {
        hasActiveDagTasks: false,
      });
      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_VICTORY_AUDIT);

      // --- SECOND FAILURE (Repeated Victory Audit Failure) ---
      const triage2 = await fsm.dispatch(LOOPER_EVENTS.EVT_VICTORY_FAIL, {
        metadata: {
          affectedModules: ["src/core"],
          culpritTaskIds: ["task-1.1"],
          reason: "Persistent regression in src/core after fix attempt",
        },
      });
      expect(triage2).toBe(LOOPER_STATES.STATE_VICTORY_TRIAGE);

      // SPEC REQUIREMENT: Victory audit fails repeatedly -> livelock prevention trips circuit breaker to ESCALATED
      expect(fsm.livelockPrevention.failureCount).toBe(2);
      expect(fsm.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.ESCALATED);
      expect(fsm.isCircuitBreakerTripped()).toBe(true);
      expect(fsm.context.circuitBreakerState).toBe(
        CIRCUIT_BREAKER_STATES.ESCALATED
      );

      // When circuit breaker is ESCALATED, EVT_TRIAGE_REOPENED is blocked by guard
      await expect(
        fsm.dispatch(LOOPER_EVENTS.EVT_TRIAGE_REOPENED, {
          hasActiveDagTasks: true,
        })
      ).rejects.toThrow(TransitionGuardError);

      // Dispatching triageVictory blocks and transitions to STATE_ABORTED
      const abortState = await fsm.triageVictory({
        culpritTaskIds: ["task-1.1"],
        activeTaskCount: 1,
      });
      expect(abortState).toBe(LOOPER_STATES.STATE_ABORTED);
      expect(fsm.isTerminal()).toBe(true);
    });
  });

  describe("History Recording & Reset", () => {
    it("records transition history and enforces maxHistorySize limit", async () => {
      const fsm = new LooperFSM({ maxHistorySize: 3 });

      await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      await fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER);
      await fsm.dispatch(LOOPER_EVENTS.EVT_WORKER_SPAWNED);
      await fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED);

      const history = fsm.getHistory();
      expect(history.length).toBe(3);
      expect(history[0]?.event).toBe(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER);
      expect(history[1]?.event).toBe(LOOPER_EVENTS.EVT_WORKER_SPAWNED);
      expect(history[2]?.event).toBe(LOOPER_EVENTS.EVT_WORK_SUBMITTED);

      fsm.clearHistory();
      expect(fsm.getHistory().length).toBe(0);
    });

    it("resets engine to initial state, clears history, and resets livelock prevention", async () => {
      const fsm = new LooperFSM();

      await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      await fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER);
      fsm.livelockPrevention.recordFailure();

      expect(fsm.getTransitionCount()).toBe(2);
      expect(fsm.livelockPrevention.failureCount).toBe(1);

      fsm.reset(LOOPER_STATES.STATE_INIT, { spawnCount: 0 });

      expect(fsm.getState()).toBe(LOOPER_STATES.STATE_INIT);
      expect(fsm.getPreviousState()).toBeNull();
      expect(fsm.getLastEvent()).toBeNull();
      expect(fsm.getTransitionCount()).toBe(0);
      expect(fsm.getHistory().length).toBe(0);
      expect(fsm.livelockPrevention.failureCount).toBe(0);
      expect(fsm.circuitBreakerState).toBe(CIRCUIT_BREAKER_STATES.CLOSED);
    });

    it("rejects invalid state in reset()", () => {
      const fsm = new LooperFSM();
      expect(() => {
        fsm.reset("INVALID_STATE" as LooperState);
      }).toThrow(InvalidStateTransitionError);
    });
  });
});
