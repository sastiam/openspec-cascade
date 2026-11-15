/**
 * V2 looper pipeline: Analyze → SDD gate → task DAG → LooperFSM → SubagentDispatcher →
 * engine session (HarnessInjector prompt) → Gate 0 → Gate 1 → Gate 2 → Gate 3 →
 * checkpoint commit, with `routeFailure` escalation, `RollbackStateBuffer` recovery and
 * `MemoryStorage` run state. The FSM's transition matrix is the single source of control flow.
 */
import { join } from "node:path";
import { CONSTANTS, type CascadeConfig } from "../../config";
import { Fatal, RollbackStateBuffer, TaskFailureError } from "../../resilience";
import { V2_PIPELINE_CONSTANTS } from "../config/constants";
import { DirectedAcyclicGraph } from "../core/dag";
import { SubagentDispatcher } from "../core/dispatcher";
import { routeFailure } from "../core/escalation";
import { LooperFSM } from "../core/fsm";
import { LOOPER_EVENTS, LOOPER_STATES, type LooperEvent, type LooperState } from "../core/fsm_types";
import { HarnessInjector, type RemediationDirective } from "../core/harness_injector";
import type { EngineOutcome } from "../engine/contract";
import { Gate0MechanicalRunner } from "../gates/gate0_qa";
import { Gate1Reviewer } from "../gates/gate1_review";
import { Gate2Challenger } from "../gates/gate2_challenger";
import { Gate3Auditor } from "../gates/gate3_audit";
import { ShadowCommitManager } from "../integration/greptile/shadow";
import { getDefaultSpawner } from "../runtime/spawner";
import type { ISpawner } from "../runtime/types";
import { analyzeChangeArtifacts, type AnalysisResult } from "../sdd/analyze";
import { evaluateSddGate } from "../sdd/sdd_gate";
import { MemoryStorage } from "../storage/memory";
import { blockedReason, commitTypeOf, markDone, readTasks, verifyCommands, type Task } from "./tasks";

export type V2TaskStatus = "done" | "failed" | "skipped";

export interface V2TaskOutcome {
  readonly taskId: string;
  readonly status: V2TaskStatus;
  readonly attempts: number;
  readonly gate2: "ran" | "skipped";
}

export interface V2ChangeReport {
  readonly change: string;
  readonly analysis: AnalysisResult;
  readonly order: readonly string[];
  readonly finalState: LooperState;
  readonly states: readonly LooperState[];
  readonly tasks: readonly V2TaskOutcome[];
}

export interface V2PlanReport {
  readonly change: string;
  readonly analysis: AnalysisResult;
  readonly order: readonly string[];
}

/**
 * Callbacks supplied by `CascadeFacade` so budget enforcement, logging and commits stay in one place.
 */
export interface V2RunHooks {
  runSession(prompt: string, resume?: string): Promise<EngineOutcome>;
  sleepUntil(epochMs: number, reason: string): Promise<void>;
  commit(message: string, extraExcludes: readonly string[]): Promise<void>;
  say(message: string): void;
  log(event: string, data: Record<string, unknown>): void;
  onRollback(record: { taskId: string; success: boolean; targetRef?: string; error?: string }): void;
}

export interface V2PipelineOptions {
  readonly spawner?: ISpawner;
  readonly harness?: HarnessInjector;
  readonly remediationDirectives?: () => readonly RemediationDirective[];
  readonly greptileContext?: (change: string) => Promise<string | undefined>;
}

interface TaskRun {
  readonly task: Task;
  readonly baselineSha: string;
  readonly verify: readonly string[];
  attempts: number;
  feedback?: string;
  sessionId?: string;
  gate2: "ran" | "skipped";
}

class EscalationSignal {
  readonly event: LooperEvent;
  readonly trace: string;

  constructor(event: LooperEvent, trace: string) {
    this.event = event;
    this.trace = trace;
  }
}

class RetrySignal {
  readonly event: LooperEvent;
  readonly feedback: string;

  constructor(event: LooperEvent, feedback: string) {
    this.event = event;
    this.feedback = feedback;
  }
}

/**
 * Sequential DAG of pending tasks: each task depends on the previous one, so sections keep their order.
 */
export function buildTaskDag(tasks: readonly Task[]): DirectedAcyclicGraph<Task> {
  return DirectedAcyclicGraph.fromTasks(
    tasks.map((task, index) => ({
      id: task.id,
      data: task,
      dependencies: index === 0 ? [] : [tasks[index - 1]?.id ?? task.id],
    })),
    { validateAcyclic: true },
  );
}

export class V2Pipeline {
  private readonly spawner: ISpawner;
  private readonly harness: HarnessInjector;
  private readonly options: V2PipelineOptions;

  constructor(options: V2PipelineOptions = {}) {
    this.options = options;
    this.spawner = options.spawner ?? getDefaultSpawner();
    this.harness = options.harness ?? new HarnessInjector();
  }

  private tasksPath(config: CascadeConfig, change: string): string {
    return join(config.repo, "openspec", "changes", change, "tasks.md");
  }

  /**
   * Validates a change (Analyze + SDD gate) and resolves the DAG execution order without side effects.
   */
  async plan(config: CascadeConfig, change: string): Promise<V2PlanReport> {
    const analysis = await analyzeChangeArtifacts(change, config.repo);
    if (!analysis.passed) {
      const blocking = analysis.findings.filter((finding) => finding.blocking).map((finding) => finding.description);
      throw new Fatal(`SDD analyze blocked change "${change}": ${blocking.join("; ") || analysis.verdict}`);
    }
    const pending = readTasks(this.tasksPath(config, change)).filter((task) => !task.done);
    if (pending.length > 0) {
      const gate = await evaluateSddGate({
        toolName: V2_PIPELINE_CONSTANTS.SDD_PROBE_TOOL,
        filePath: join(config.repo, V2_PIPELINE_CONSTANTS.SDD_PROBE_FILE),
        repoRoot: config.repo,
      });
      if (!gate.allowed) {
        throw new Fatal(`SDD gate blocked change "${change}": ${gate.reason ?? "no active change"}`);
      }
    }
    return { change, analysis, order: buildTaskDag(pending).topologicalSort() };
  }

  private async git(config: CascadeConfig, args: readonly string[]): Promise<string> {
    const result = await this.spawner.run(["git", ...args], { cwd: config.repo, timeoutMs: config.commandTimeoutMs });
    return result.stdout.trim();
  }

  /**
   * Runs every pending task of `change` through the FSM-driven gate pipeline.
   */
  async runChange(config: CascadeConfig, change: string, hooks: V2RunHooks): Promise<V2ChangeReport> {
    const plan = await this.plan(config, change);
    const tasksPath = this.tasksPath(config, change);
    const tasksById = new Map(readTasks(tasksPath).map((task) => [task.id, task]));
    const states: LooperState[] = [];
    const fsm = new LooperFSM({
      enableStandardGuards: true,
      guardOptions: { maxAttempts: config.maxAttemptsPerTask, maxChallengeAttempts: config.maxAttemptsPerTask },
      initialContext: { hasActiveDagTasks: plan.order.length > 0 },
      onTransition: (payload) => {
        states.push(payload.to);
        hooks.log("v2_transition", { change, from: payload.from, to: payload.to, event: payload.event });
      },
    });
    const dispatcher = new SubagentDispatcher({ workspaceRoot: config.repo, autoCleanup: false });
    const memory = new MemoryStorage({ repoRoot: config.repo });
    const outcomes: V2TaskOutcome[] = [];
    hooks.say(`=== ${change} === (v2 pipeline: ${plan.order.length} task(s), analyze ${plan.analysis.verdict})`);

    const persist = async (): Promise<V2ChangeReport> => {
      const report: V2ChangeReport = { change, analysis: plan.analysis, order: plan.order, finalState: fsm.state, states, tasks: outcomes };
      await memory.writeStateAtomic(`${V2_PIPELINE_CONSTANTS.STATE_PREFIX}${change}`, report);
      return report;
    };

    try {
      await fsm.dispatch(LOOPER_EVENTS.EVT_INIT_SUCCESS);
      for (const taskId of plan.order) {
        const task = tasksById.get(taskId);
        if (task === undefined) continue;
        if (CONSTANTS.HUMAN_TASK_REGEX.test(task.text)) {
          hooks.say(`  skipping ${task.id} (human task)`);
          outcomes.push({ taskId, status: "skipped", attempts: 0, gate2: "skipped" });
          continue;
        }
        outcomes.push(await this.runTask(config, change, tasksPath, task, fsm, dispatcher, hooks));
      }
      await fsm.dispatch(LOOPER_EVENTS.EVT_ALL_TASKS_DONE, { hasActiveDagTasks: false });
      const unfinished = readTasks(tasksPath).filter(
        (task) => !task.done && outcomes.some((outcome) => outcome.taskId === task.id && outcome.status === "done"),
      );
      if (unfinished.length === 0) {
        await fsm.dispatch(LOOPER_EVENTS.EVT_VICTORY_PASS);
      } else {
        await fsm.dispatch(LOOPER_EVENTS.EVT_VICTORY_FAIL);
        await fsm.dispatch(LOOPER_EVENTS.EVT_TRIAGE_BLOCKED);
        throw new Fatal(`Victory audit failed for ${change}: ${unfinished.map((task) => task.id).join(", ")} still unchecked`);
      }
      return await persist();
    } catch (error) {
      await persist().catch(() => undefined);
      throw error;
    }
  }

  private async runTask(
    config: CascadeConfig,
    change: string,
    tasksPath: string,
    task: Task,
    fsm: LooperFSM,
    dispatcher: SubagentDispatcher,
    hooks: V2RunHooks,
  ): Promise<V2TaskOutcome> {
    const run: TaskRun = {
      task,
      baselineSha: await this.git(config, ["rev-parse", "HEAD"]),
      verify: verifyCommands(task, config.fullGate, { repoRoot: config.repo, config }),
      attempts: 0,
      gate2: "skipped",
    };
    const rollbackBuffer = new RollbackStateBuffer({
      cwd: config.repo,
      excludes: [...config.neverCommit, ...V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES],
      timeoutMs: config.commandTimeoutMs,
      hooks: { say: hooks.say, log: hooks.log },
    });
    await rollbackBuffer.snapshot();
    hooks.say(`▶ ${change} ${task.id}: ${task.text.slice(0, CONSTANTS.TASK_SUMMARY_MAX_LENGTH)}`);

    await fsm.dispatch(LOOPER_EVENTS.EVT_TASK_SELECTED_WORKER, {
      taskId: task.id,
      taskRole: "worker",
      hasActiveDagTasks: true,
      baselineSha: run.baselineSha,
      gate0Attempts: 0,
      gate1Attempts: 0,
      gate2Attempts: 0,
    });
    const worker = await dispatcher.dispatch({ role: "worker", taskId: task.id, taskDescription: task.text });
    await fsm.dispatch(LOOPER_EVENTS.EVT_WORKER_SPAWNED);

    for (;;) {
      try {
        await this.attempt(config, change, run, fsm, hooks);
        markDone(tasksPath, task.id);
        await hooks.commit(this.commitMessage(change, task), V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES);
        await fsm.dispatch(LOOPER_EVENTS.EVT_CHECKPOINT_COMMITTED, { taskId: undefined, hasActiveDagTasks: true });
        await dispatcher.completeAgent(worker.id, { handoffContent: `task ${task.id} committed` }).catch(() => undefined);
        return { taskId: task.id, status: "done", attempts: run.attempts, gate2: run.gate2 };
      } catch (signal) {
        if (signal instanceof RetrySignal || signal instanceof EscalationSignal) {
          hooks.log("v2_failure", {
            change,
            taskId: task.id,
            event: signal.event,
            attempt: run.attempts,
            trace: signal instanceof RetrySignal ? signal.feedback : signal.trace,
          });
        }
        if (signal instanceof RetrySignal) {
          await fsm.dispatch(signal.event, this.attemptContext(run));
          run.feedback = signal.feedback;
          continue;
        }
        if (!(signal instanceof EscalationSignal)) throw signal;
        await fsm.dispatch(signal.event, this.attemptContext(run));
        const decision = routeFailure(
          signal.trace,
          { maxRetryAttempts: config.maxAttemptsPerTask, taskId: task.id, baselineSha: run.baselineSha },
          { taskId: task.id, attempt: run.attempts, maxAttempts: config.maxAttemptsPerTask, baselineSha: run.baselineSha },
        );
        hooks.log("v2_escalation", { change, taskId: task.id, target: decision.target, category: decision.classification.category });
        if (decision.suggestedFsmEvent === LOOPER_EVENTS.EVT_ESCALATION_FATAL) {
          await fsm.dispatch(LOOPER_EVENTS.EVT_ESCALATION_FATAL);
          throw new Fatal(`Task ${task.id} escalated as fatal: ${signal.trace.slice(0, CONSTANTS.ERROR_DETAIL_MAX_LENGTH)}`);
        }
        if (run.attempts < config.maxAttemptsPerTask) {
          await fsm.dispatch(LOOPER_EVENTS.EVT_DIAGNOSTIC_RETRY, this.attemptContext(run));
          run.feedback = decision.enrichedPrompt ?? signal.trace;
          continue;
        }
        await fsm.dispatch(LOOPER_EVENTS.EVT_ROLLBACK_REQUIRED);
        const rollback = await rollbackBuffer.rollback();
        hooks.onRollback({ taskId: task.id, success: rollback.success, targetRef: rollback.targetRef, error: rollback.error });
        hooks.say(`  ⚠️ Task ${task.id} exhausted ${run.attempts} attempts; rollback ${rollback.success ? "restored" : "failed for"} ${rollback.targetRef}`);
        if (config.resilient) {
          await fsm.dispatch(LOOPER_EVENTS.EVT_REDECOMPOSE_REQUIRED, { taskId: undefined, hasActiveDagTasks: true });
          return { taskId: task.id, status: "failed", attempts: run.attempts, gate2: run.gate2 };
        }
        await fsm.dispatch(LOOPER_EVENTS.EVT_ESCALATION_FAILED);
        throw new TaskFailureError(task.id, change, run.attempts);
      }
    }
  }

  private attemptContext(run: TaskRun): { gate0Attempts: number; gate1Attempts: number; gate2Attempts: number } {
    return { gate0Attempts: run.attempts, gate1Attempts: run.attempts, gate2Attempts: run.attempts };
  }

  private commitMessage(change: string, task: Task): string {
    const type = commitTypeOf(task) ?? V2_PIPELINE_CONSTANTS.DEFAULT_COMMIT_TYPE;
    return `${type}(${change}): ${task.id} ${task.text}`.slice(0, CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH);
  }

  private async attempt(config: CascadeConfig, change: string, run: TaskRun, fsm: LooperFSM, hooks: V2RunHooks): Promise<void> {
    run.attempts++;
    const harness = await this.harness.buildExecutionContext({
      repoRoot: config.repo,
      changeId: change,
      task: run.task,
      verifyCommands: run.verify,
      greptileContext: await this.options.greptileContext?.(change),
      remediationDirectives: this.options.remediationDirectives?.(),
      guardrails: {
        protectedBranches: config.protectedBranches,
        deniedCommands: config.deniedBash,
        maxBudgetPerSessionUsd: config.maxBudgetPerSessionUsd,
      },
      retryFeedback: run.feedback,
    });
    hooks.log("v2_harness", { taskId: run.task.id, attempt: run.attempts, tokens: harness.totalTokens, sections: harness.sections.map((section) => section.name) });

    let outcome = await hooks.runSession(harness.prompt, run.sessionId);
    while (outcome.kind === "paused") {
      await hooks.sleepUntil(outcome.resumeAt, "plan usage limit");
      outcome = await hooks.runSession(`Continue task ${run.task.id} from the current working tree.`, outcome.sessionId ?? run.sessionId);
    }
    if (outcome.kind === "fatal") {
      throw new EscalationSignal(LOOPER_EVENTS.EVT_WORKER_TIMEOUT, `fatal: ${outcome.reason}`);
    }
    run.sessionId = outcome.sessionId ?? run.sessionId;
    if (outcome.kind === "error") {
      throw new EscalationSignal(LOOPER_EVENTS.EVT_WORKER_TIMEOUT, outcome.reason);
    }
    const blocked = blockedReason(outcome.result);
    if (blocked) throw new Fatal(`Task ${run.task.id} needs a human decision: ${blocked}`);
    await fsm.dispatch(LOOPER_EVENTS.EVT_WORK_SUBMITTED);

    const workingTree = await new ShadowCommitManager({ spawner: this.spawner, timeoutMs: config.commandTimeoutMs }).workingTreeDiff(
      config.repo,
      run.baselineSha,
    );
    const affectedFiles = [...workingTree.files];
    const gate0 = await new Gate0MechanicalRunner({
      repoRoot: config.repo,
      cwd: config.repo,
      commands: run.verify.length ? [...run.verify] : [...config.defaultVerify],
      affectedFiles,
      taskId: run.task.id,
      attempt: run.attempts,
      maxAttempts: config.maxAttemptsPerTask,
      perCommandTimeoutMs: config.commandTimeoutMs,
      allowFastTrack: true,
    }).run();
    hooks.log("v2_gate0", { taskId: run.task.id, verdict: gate0.verdict, summary: gate0.summary });
    if (!gate0.success) {
      const feedback = gate0.feedbackPrompt ?? gate0.summary;
      if (run.attempts < config.maxAttemptsPerTask) throw new RetrySignal(LOOPER_EVENTS.EVT_G0_RETRY, feedback);
      throw new EscalationSignal(LOOPER_EVENTS.EVT_G0_EXHAUSTED, feedback);
    }
    const fastTrack = gate0.recommendedEvent === LOOPER_EVENTS.EVT_G0_PASS_FAST_TRACK;
    await fsm.dispatch(fastTrack ? LOOPER_EVENTS.EVT_G0_PASS_FAST_TRACK : LOOPER_EVENTS.EVT_G0_PASS, { isFastTrack: fastTrack, ...this.attemptContext(run) });

    if (!fastTrack) {
      await this.semanticGates(config, run, fsm, hooks, affectedFiles, workingTree.patch);
    }

    const gate3 = await new Gate3Auditor({
      workspaceRoot: config.repo,
      repoRoot: config.repo,
      taskId: run.task.id,
      taskDescription: run.task.text,
      baselineSha: run.baselineSha,
      attempt: run.attempts,
      maxAttempts: config.maxAttemptsPerTask,
      skipCleanRoomQa: true,
      autoRollbackOnVeto: false,
      autoCleanup: true,
      diff: workingTree.patch,
      targetFiles: affectedFiles,
    }).run();
    hooks.log("v2_gate3", { taskId: run.task.id, verdict: gate3.verdict, veto: gate3.veto });
    if (gate3.veto) {
      throw new EscalationSignal(LOOPER_EVENTS.EVT_G3_VETO, gate3.structuredFeedback.markdownReport);
    }
    await fsm.dispatch(LOOPER_EVENTS.EVT_G3_PASS);
  }

  private async semanticGates(
    config: CascadeConfig,
    run: TaskRun,
    fsm: LooperFSM,
    hooks: V2RunHooks,
    affectedFiles: readonly string[],
    patch: string,
  ): Promise<void> {
    const gate1 = await new Gate1Reviewer({
      diff: patch,
      targetFiles: affectedFiles,
      workspaceRoot: config.repo,
      repoRoot: config.repo,
      taskId: run.task.id,
      taskDescription: run.task.text,
      baselineSha: run.baselineSha,
      attempt: run.attempts,
      maxAttempts: config.maxAttemptsPerTask,
      autoCleanup: true,
    }).run();
    hooks.log("v2_gate1", { taskId: run.task.id, verdict: gate1.verdict, event: gate1.recommendedEvent });
    const gate1Feedback = gate1.feedback?.markdownFeedback ?? gate1.report.summary;
    if (gate1.recommendedEvent === LOOPER_EVENTS.EVT_G1_REVISE) throw new RetrySignal(LOOPER_EVENTS.EVT_G1_REVISE, gate1Feedback);
    if (gate1.recommendedEvent === LOOPER_EVENTS.EVT_G1_REJECT) throw new EscalationSignal(LOOPER_EVENTS.EVT_G1_REJECT, gate1Feedback);
    await fsm.dispatch(LOOPER_EVENTS.EVT_G1_PASS, this.attemptContext(run));

    const codeTargets = affectedFiles.filter((file) => V2_PIPELINE_CONSTANTS.CHALLENGE_EXTENSIONS.some((ext) => file.endsWith(ext)));
    const canChallenge = config.fullGate && codeTargets.length > 0 && this.spawner.which(V2_PIPELINE_CONSTANTS.CHALLENGE_RUNTIME) !== null;
    if (!canChallenge) {
      hooks.log("v2_gate2", { taskId: run.task.id, verdict: "skipped", reason: config.fullGate ? "no code targets or bun runtime" : "enable with --full-gate" });
      await fsm.dispatch(LOOPER_EVENTS.EVT_G2_PASS, this.attemptContext(run));
      return;
    }
    run.gate2 = "ran";
    const gate2 = await new Gate2Challenger({
      workspaceRoot: config.repo,
      repoRoot: config.repo,
      taskId: run.task.id,
      taskDescription: run.task.text,
      targetFiles: codeTargets,
      baselineSha: run.baselineSha,
      attempt: run.attempts,
      maxAttempts: config.maxAttemptsPerTask,
      autoCleanup: true,
      preserveBreakingProbes: false,
      diff: patch,
    }).run();
    hooks.log("v2_gate2", { taskId: run.task.id, verdict: gate2.verdict, event: gate2.recommendedEvent });
    const gate2Feedback = [gate2.report.summary, ...(gate2.feedback?.recommendations ?? [])].join("\n");
    if (gate2.recommendedEvent === LOOPER_EVENTS.EVT_G2_BREAK) throw new RetrySignal(LOOPER_EVENTS.EVT_G2_BREAK, gate2Feedback);
    if (gate2.recommendedEvent === LOOPER_EVENTS.EVT_G2_EXHAUSTED) throw new EscalationSignal(LOOPER_EVENTS.EVT_G2_EXHAUSTED, gate2Feedback);
    await fsm.dispatch(LOOPER_EVENTS.EVT_G2_PASS, this.attemptContext(run));
  }
}

export { LOOPER_STATES };
