/**
 * `CascadeFacade`: single orchestration entry point behind the thin `cascade.ts` CLI.
 *
 * Owns preflight (protected branches, dirty tree), dry-run planning, keep-alive,
 * engine construction (factory + resilience + telemetry decorators), the per-task
 * session/verification/commit loop, git rollback and the structured run result.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeToolInput, oneLine } from "../../antigravity";
import {
  BudgetExceededError,
  ConfigValidationError,
  CONSTANTS,
  enforceSessionBudget,
  evaluateProtectedBranchGuard,
  EXIT_CODE_CONSTANTS,
  ProtectedBranchError,
  redactSensitiveData,
  type CascadeConfig,
} from "../../config";
import { syncDiagrams } from "../../diagrams";
import type { EngineOutcome, UsageMeter } from "../engine/contract";
import { startKeepAlive, type KeepAliveController, type KeepAliveOptions } from "../../platform";
import { selectVerifyChecks } from "../../fast_track";
import { runVerificationPhase } from "../../qa";
import { Fatal, RollbackStateBuffer, TaskFailureError } from "../../resilience";
import { OPENSPEC_PROPOSE_HINT, TASKS_LINT_CONSTANTS, V2_PIPELINE_CONSTANTS } from "../config/constants";
import { ResilientEngineDecorator, type ResilienceOptions } from "../decorators/resilient_engine";
import { formatFinding, lintTasks } from "../sdd/tasks_lint";
import {
  summarizeTelemetry,
  TelemetryMetricsDecorator,
  type SessionTelemetryRecord,
  type TelemetrySummary,
} from "../decorators/telemetry_metrics";
import { formatRemediationDirectives, type RemediationDirective } from "../core/harness_injector";
import { SelfImprover } from "../core/self_improver";
import { EngineFactory, type UnifiedEngine } from "../pal/factory";
import { getDefaultSpawner } from "../runtime/spawner";
import type { ISpawner } from "../runtime/types";
import {
  blockedReason,
  commitsPerSection,
  commitTypeOf,
  isLastOfSection,
  markDone,
  readTasks,
  taskPrompt,
  verifyCommands,
  type Task,
} from "./tasks";
import { V2Pipeline, type V2ChangeReport, type V2RunHooks } from "./v2_pipeline";

export type ChangeStatus = "done" | "planned" | "missing" | "failed";

export interface ChangeRunReport {
  readonly change: string;
  status: ChangeStatus;
  pendingTasks: number;
  readonly skippedHumanTasks: string[];
}

export interface TaskRunRecord {
  readonly change: string;
  readonly taskId: string;
  readonly status: "done" | "failed" | "skipped";
  readonly attempts: number;
}

export interface RollbackRecord {
  readonly change: string;
  readonly taskId: string;
  readonly success: boolean;
  readonly targetRef?: string;
  readonly error?: string;
}

export interface CascadeRunResult {
  readonly exitCode: number;
  readonly mode: CascadeConfig["mode"];
  readonly dryRun: boolean;
  readonly changes: readonly ChangeRunReport[];
  readonly tasks: readonly TaskRunRecord[];
  readonly rollbacks: readonly RollbackRecord[];
  readonly telemetry: TelemetrySummary;
  readonly totalCostUsd: number;
  readonly logFile?: string;
  readonly error?: string;
  readonly errorKind?: "fail_closed" | "crash";
  readonly usage?: UsageMeter[] | null;
  readonly v2Reports?: readonly V2ChangeReport[];
}

export interface CascadeOutput {
  info(message: string): void;
  error(message: string): void;
}

export interface CascadeFacadeDependencies {
  readonly spawner?: ISpawner;
  readonly engineFactory?: EngineFactory;
  /** Pre-built engine (already decorated or not); bypasses the factory. */
  readonly engine?: UnifiedEngine;
  readonly resilience?: ResilienceOptions | false;
  readonly output?: CascadeOutput;
  readonly keepAlive?: Omit<KeepAliveOptions, "enabled">;
  readonly telemetrySink?: (record: SessionTelemetryRecord) => void;
  readonly v2Pipeline?: V2Pipeline;
  readonly remediationDirectives?: () => readonly RemediationDirective[];
  readonly selfImprover?: SelfImprover;
}

interface RunContext {
  readonly config: CascadeConfig;
  readonly engine: UnifiedEngine;
  readonly telemetry: TelemetryMetricsDecorator;
  readonly logFile: string;
  logDirReady: boolean;
  totalCostUsd: number;
  announcedModel?: string;
  readonly changes: ChangeRunReport[];
  readonly tasks: TaskRunRecord[];
  readonly rollbacks: RollbackRecord[];
  readonly v2Reports: V2ChangeReport[];
  readonly selfImprover?: SelfImprover;
  readonly directives: readonly RemediationDirective[];
  usage?: UsageMeter[] | null;
  /** Last commit whose tree passed verification; the fast-track diffs against it, never against an unchecked HEAD. */
  lastVerifiedSha?: string;
}

const consoleOutput: CascadeOutput = {
  info: (message) => console.log(message),
  error: (message) => console.error(message),
};

/**
 * Errors that stop the cascade deliberately (exit code 2) rather than crashing (exit code 1).
 */
export function isFailClosedError(error: unknown): boolean {
  return (
    error instanceof ConfigValidationError ||
    error instanceof BudgetExceededError ||
    error instanceof ProtectedBranchError ||
    error instanceof Fatal
  );
}

export class CascadeFacade {
  private readonly spawner: ISpawner;
  private readonly engineFactory: EngineFactory;
  private readonly dependencies: CascadeFacadeDependencies;
  private readonly output: CascadeOutput;
  private keepAliveController: KeepAliveController | undefined;

  constructor(dependencies: CascadeFacadeDependencies = {}) {
    this.dependencies = dependencies;
    this.spawner = dependencies.spawner ?? getDefaultSpawner();
    this.engineFactory = dependencies.engineFactory ?? new EngineFactory({ spawner: this.spawner });
    this.output = dependencies.output ?? consoleOutput;
  }

  /**
   * The keep-alive controller of the current (or last) run, if one was started.
   */
  getKeepAliveController(): KeepAliveController | undefined {
    return this.keepAliveController;
  }

  /**
   * Builds the decorated engine: Telemetry(Resilient(EngineFactory.create(engine))).
   */
  /**
   * Returns the self-improver for a run (telemetry enabled and not a dry run), if any.
   */
  createSelfImprover(config: CascadeConfig): SelfImprover | undefined {
    if (!config.telemetry.enabled || config.dryRun) return undefined;
    return this.dependencies.selfImprover ?? new SelfImprover({ dir: config.telemetry.telemetryDir, rootDir: config.repo });
  }

  buildEngine(
    config: CascadeConfig,
    selfImprover?: SelfImprover,
  ): { engine: UnifiedEngine; telemetry: TelemetryMetricsDecorator } {
    const base = this.dependencies.engine ?? this.engineFactory.create(config.engine, { cwd: config.repo, model: config.model });
    const resilient =
      this.dependencies.resilience === false
        ? base
        : new ResilientEngineDecorator(base, {
            sleep: (ms) => this.spawner.sleep(ms),
            ...(this.dependencies.resilience ?? {}),
          });
    const telemetry = new TelemetryMetricsDecorator(resilient, {
      sink: (record) => {
        this.dependencies.telemetrySink?.(record);
        selfImprover?.recordOutcome({
          source: "session",
          engine: record.engine,
          outcome: record.outcome,
          failureTrace: record.errorMessage,
          costUsd: record.costUsd,
          latencyMs: record.latencyMs,
        });
      },
    });
    return { engine: telemetry, telemetry };
  }

  /**
   * Runs the configured cascade and returns a structured result. Never throws.
   */
  async run(config: CascadeConfig): Promise<CascadeRunResult> {
    let ctx: RunContext | undefined;
    try {
      const selfImprover = this.createSelfImprover(config);
      const { engine, telemetry } = this.buildEngine(config, selfImprover);
      ctx = {
        config,
        engine,
        telemetry,
        logFile: join(config.logDir, `${new Date().toISOString().replaceAll(":", "-")}.jsonl`),
        logDirReady: false,
        totalCostUsd: 0,
        changes: config.changes.map((change) => ({ change, status: "planned", pendingTasks: 0, skippedHumanTasks: [] })),
        tasks: [],
        rollbacks: [],
        v2Reports: [],
        selfImprover,
        directives: this.dependencies.remediationDirectives?.() ?? selfImprover?.deriveDirectives() ?? [],
      };
      await this.execute(ctx);
      return this.result(ctx, EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS);
    } catch (error) {
      this.keepAliveController?.stop();
      const message = error instanceof Error ? error.message : String(error);
      const failClosed = isFailClosedError(error);
      if (failClosed) {
        this.output.error(`STOPPED: ${message}`);
      } else {
        this.output.error(`CRASHED: ${error instanceof Error && error.stack ? error.stack : message}`);
      }
      return this.result(
        ctx,
        failClosed ? EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL : EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR,
        message,
        failClosed ? "fail_closed" : "crash",
        config,
      );
    }
  }

  private result(
    ctx: RunContext | undefined,
    exitCode: number,
    error?: string,
    errorKind?: "fail_closed" | "crash",
    config?: CascadeConfig,
  ): CascadeRunResult {
    const effectiveConfig = ctx?.config ?? config;
    return {
      exitCode,
      mode: effectiveConfig?.mode ?? "v1",
      dryRun: effectiveConfig?.dryRun ?? false,
      changes: ctx?.changes ?? [],
      tasks: ctx?.tasks ?? [],
      rollbacks: ctx?.rollbacks ?? [],
      telemetry: ctx?.telemetry.getSummary() ?? summarizeTelemetry([]),
      totalCostUsd: ctx?.totalCostUsd ?? 0,
      logFile: ctx !== undefined && ctx.logDirReady ? ctx.logFile : undefined,
      error,
      errorKind,
      usage: ctx?.usage,
      v2Reports: ctx?.v2Reports,
    };
  }

  private log(ctx: RunContext, event: string, data: Record<string, unknown> = {}): void {
    if (ctx.config.dryRun) return;
    if (event === "v2_failure" && typeof data.trace === "string") {
      ctx.selfImprover?.recordOutcome({
        source: "gate",
        change: typeof data.change === "string" ? data.change : undefined,
        taskId: typeof data.taskId === "string" ? data.taskId : undefined,
        outcome: typeof data.event === "string" ? data.event : "v2_failure",
        failureTrace: data.trace,
        attempt: typeof data.attempt === "number" ? data.attempt : undefined,
      });
    }
    if (!ctx.logDirReady) {
      mkdirSync(ctx.config.logDir, { recursive: true });
      ctx.logDirReady = true;
    }
    const rawPayload = { t: new Date().toISOString(), event, ...data };
    const payload = ctx.config.telemetry.redactSecrets
      ? redactSensitiveData(rawPayload, ctx.config.telemetry.maxRedactionDepth)
      : rawPayload;
    appendFileSync(ctx.logFile, JSON.stringify(payload) + "\n");
  }

  private say(ctx: RunContext, message: string): void {
    this.output.info(`[${new Date().toLocaleTimeString()}] ${message}`);
    this.log(ctx, "say", { message });
  }

  private progress(message: string): void {
    this.output.info(`[${new Date().toLocaleTimeString()}]     ${message}`);
  }

  private async git(ctx: RunContext, args: readonly string[]): Promise<{ code: number; output: string }> {
    const result = await this.spawner.run(["git", ...args], {
      cwd: ctx.config.repo,
      timeoutMs: ctx.config.commandTimeoutMs,
    });
    return { code: result.exitCode, output: (result.stdout + result.stderr).trim() };
  }

  private async execute(ctx: RunContext): Promise<void> {
    this.keepAliveController = startKeepAlive({ ...(this.dependencies.keepAlive ?? {}), enabled: ctx.config.keepAlive });
    this.log(ctx, "keep_alive", {
      active: this.keepAliveController.active,
      mechanism: this.keepAliveController.mechanism,
    });
    try {
      await this.preflight(ctx);
      if (ctx.config.mode === "v2") {
        await this.executeV2(ctx);
        return;
      }
      if (ctx.config.dryRun) {
        this.printPlan(ctx);
        ctx.usage = await this.readUsage(ctx);
        this.output.info(`\nusage: ${ctx.usage ? JSON.stringify(ctx.usage) : "unavailable (API key or token without user:profile scope)"}`);
        return;
      }
      const report: string[] = [];
      for (const changeReport of ctx.changes) {
        const skipped = await this.runChange(ctx, changeReport);
        report.push(`${changeReport.change}: done${skipped.length ? `, human tasks pending: ${skipped.join(", ")}` : ""}`);
      }
      this.say(
        ctx,
        `Cascade finished. Estimated cost $${ctx.totalCostUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)}\n${report.join("\n")}`,
      );
    } finally {
      this.keepAliveController.stop();
    }
  }

  private v2Pipeline(directives: readonly RemediationDirective[]): V2Pipeline {
    return (
      this.dependencies.v2Pipeline ??
      new V2Pipeline({ spawner: this.spawner, remediationDirectives: () => directives })
    );
  }

  private async executeV2(ctx: RunContext): Promise<void> {
    const pipeline = this.v2Pipeline(ctx.directives);
    if (ctx.config.dryRun) {
      for (const changeReport of ctx.changes) {
        if (!existsSync(this.tasksPath(ctx, changeReport.change))) {
          changeReport.status = "missing";
          this.output.info(`\n${changeReport.change}: MISSING (create it with ${OPENSPEC_PROPOSE_HINT})`);
          continue;
        }
        const plan = await pipeline.plan(ctx.config, changeReport.change);
        changeReport.pendingTasks = plan.order.length;
        this.output.info(`\n${changeReport.change}: ${plan.order.length} pending (v2 pipeline, analyze ${plan.analysis.verdict})`);
        this.output.info(`  dag order: ${plan.order.join(" -> ") || "(none)"}`);
      }
      return;
    }
    const hooks: V2RunHooks = {
      runSession: (prompt, resume) => this.runSession(ctx, prompt, resume),
      sleepUntil: (epochMs, reason) => this.sleepUntil(ctx, epochMs, reason),
      commit: (message, extraExcludes) => this.commitChanges(ctx, message, extraExcludes),
      say: (message) => this.say(ctx, message),
      log: (event, data) => this.log(ctx, event, data),
      onRollback: (record) => ctx.rollbacks.push({ change: currentChange, ...record }),
    };
    let currentChange = "";
    const report: string[] = [];
    for (const changeReport of ctx.changes) {
      currentChange = changeReport.change;
      const tasksPath = this.tasksPath(ctx, changeReport.change);
      changeReport.pendingTasks = existsSync(tasksPath) ? readTasks(tasksPath).filter((task) => !task.done).length : 0;
      try {
        const v2Report = await pipeline.runChange(ctx.config, changeReport.change, hooks);
        ctx.v2Reports.push(v2Report);
        for (const outcome of v2Report.tasks) {
          ctx.tasks.push({ change: changeReport.change, taskId: outcome.taskId, status: outcome.status, attempts: outcome.attempts });
          if (outcome.status === "skipped") changeReport.skippedHumanTasks.push(outcome.taskId);
        }
        changeReport.status = "done";
        changeReport.pendingTasks = readTasks(tasksPath).filter((task) => !task.done).length;
        report.push(`${changeReport.change}: ${v2Report.finalState}`);
      } catch (error) {
        changeReport.status = "failed";
        if (error instanceof TaskFailureError) {
          ctx.tasks.push({ change: changeReport.change, taskId: error.taskId, status: "failed", attempts: error.attempts });
        }
        throw error;
      }
    }
    this.say(ctx, `Cascade v2 finished. Estimated cost $${ctx.totalCostUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)}\n${report.join("\n")}`);
  }

  /**
   * Lints the tasks.md of every listed change before any session starts; a dry run starts no session, so it is not linted.
   * A listed change without tasks.md is left to the existing missing-file handling.
   */
  private lintChanges(ctx: RunContext): void {
    if (ctx.config.dryRun) return;
    const findings = ctx.config.changes.flatMap((change) => {
      const tasksPath = this.tasksPath(ctx, change);
      if (!existsSync(tasksPath)) return [];
      return lintTasks(readFileSync(tasksPath, "utf8")).map((finding) => formatFinding(change, finding));
    });
    if (findings.length > 0) throw new Fatal(`${TASKS_LINT_CONSTANTS.FATAL_HEADER}\n${findings.join("\n")}`);
  }

  private async preflight(ctx: RunContext): Promise<void> {
    if (!ctx.config.changes.length) throw new Fatal("Pass --changes a,b,c in cascade order");
    this.lintChanges(ctx);
    if (ctx.config.settings) {
      if (!existsSync(ctx.config.settings)) throw new Fatal(`--settings file not found: ${ctx.config.settings}`);
      if (ctx.config.engine !== "claude") {
        this.say(ctx, `--settings applies to the Claude engine only; ignored for engine=${ctx.config.engine}`);
      }
    }
    const branch = (await this.git(ctx, ["branch", "--show-current"])).output;
    const branchGuard = evaluateProtectedBranchGuard({
      branch,
      protectedBranches: ctx.config.protectedBranches,
      dryRun: ctx.config.dryRun,
    });
    if (!branchGuard.allowed) {
      throw new ProtectedBranchError(branch, branchGuard.warning);
    }
    if (branchGuard.warning) {
      this.say(ctx, `warning: ${branchGuard.warning}`);
    }
    const dirty = (await this.git(ctx, ["status", "--porcelain", "--untracked-files=all"])).output
      .split("\n")
      .filter(
        (line) =>
          line &&
          ![...ctx.config.neverCommit, ...V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES].some((path) =>
            line.slice(CONSTANTS.GIT_STATUS_PREFIX_LENGTH).startsWith(path),
          ),
      );
    if (dirty.length) {
      const warning = `Working tree is dirty (these files would land in the first commit):\n${dirty.join("\n")}`;
      if (!ctx.config.allowDirty && !ctx.config.dryRun) throw new Fatal(`${warning}\nClean it or pass --allow-dirty.`);
      this.say(ctx, warning);
    }
    const keepAliveStatus = this.keepAliveController ? `keepAlive=${this.keepAliveController.mechanism} ` : "";
    this.say(
      ctx,
      `engine=${ctx.config.engine} ${keepAliveStatus}repo=${ctx.config.repo} branch=${branch} changes=${ctx.config.changes.join(" → ")} log=${ctx.config.dryRun ? "disabled (dry-run)" : ctx.logFile}${ctx.config.settings ? ` settings=${ctx.config.settings}` : ""}`,
    );
  }

  private tasksPath(ctx: RunContext, change: string): string {
    return join(ctx.config.repo, "openspec", "changes", change, "tasks.md");
  }

  private printPlan(ctx: RunContext): void {
    for (const changeReport of ctx.changes) {
      const tasksPath = this.tasksPath(ctx, changeReport.change);
      if (!existsSync(tasksPath)) {
        changeReport.status = "missing";
        this.output.info(`\n${changeReport.change}: MISSING (create it with ${OPENSPEC_PROPOSE_HINT})`);
        continue;
      }
      const tasks = readTasks(tasksPath);
      const pending = tasks.filter((task) => !task.done);
      changeReport.pendingTasks = pending.length;
      const perSection = commitsPerSection(tasks);
      this.output.info(`\n${changeReport.change}: ${pending.length} pending${perSection ? " (one commit per section)" : ""}`);
      for (const task of pending) {
        const verify = verifyCommands(task, ctx.config.fullGate, { repoRoot: ctx.config.repo, config: ctx.config });
        const flags = [
          CONSTANTS.HUMAN_TASK_REGEX.test(task.text) ? "HUMAN-SKIP" : "",
          commitTypeOf(task)
            ? `commit=${commitTypeOf(task)}`
            : perSection && isLastOfSection(tasks, task)
              ? "commit=agent"
              : "",
          verify.length ? `verify=[${verify.join(" | ")}]` : "",
        ].filter(Boolean);
        this.output.info(`  ${task.id} ${flags.join(" ")}`);
      }
    }
  }

  private async readUsage(ctx: RunContext): Promise<UsageMeter[] | null> {
    if (!ctx.engine.supportsPlanMeters() || !ctx.engine.readUsage) return null;
    try {
      return await ctx.engine.readUsage(ctx.config.repo);
    } catch (error) {
      this.log(ctx, "usage_read_failed", { error: String(error) });
      return null;
    }
  }

  private async sleepUntil(ctx: RunContext, epochMs: number, reason: string): Promise<void> {
    const ms = Math.max(ctx.config.minPauseMs, epochMs - Date.now());
    this.say(
      ctx,
      `Pausing ${Math.round(ms / CONSTANTS.MS_PER_MINUTE)} min (${reason}); resuming around ${new Date(Date.now() + ms).toLocaleString()}`,
    );
    await this.spawner.sleep(ms);
  }

  private async waitForUsageHeadroom(ctx: RunContext): Promise<void> {
    if (!ctx.engine.supportsPlanMeters()) return;
    for (;;) {
      const meters = await this.readUsage(ctx);
      if (!meters) return;
      const blocking = meters.filter((meter) => meter.percent >= ctx.config.usageLimitPercent);
      if (!blocking.length) return;
      const resets = blocking.map((meter) => meter.resetsAt).filter((reset): reset is number => reset !== null);
      const until = resets.length
        ? Math.max(...resets) + ctx.config.resetMarginMs
        : Date.now() + ctx.config.unknownResetSleepMs;
      await this.sleepUntil(ctx, until, blocking.map((meter) => `${meter.kind} ${meter.percent}%`).join(", "));
    }
  }

  private async runSession(ctx: RunContext, prompt: string, resume?: string): Promise<EngineOutcome> {
    const engine = ctx.engine;
    const defaultModel = engine.getDefaultModel(ctx.config.effort ?? CONSTANTS.DEFAULT_EFFORT);
    const model = ctx.config.model ?? defaultModel;
    const displayModel =
      ctx.config.effort && ctx.config.effort !== "none" ? `${model} (effort: ${ctx.config.effort})` : model;

    if (ctx.config.engine !== "claude" && displayModel !== ctx.announcedModel) {
      ctx.announcedModel = displayModel;
      this.say(ctx, `  model: ${displayModel} (${ctx.config.engine})`);
    }

    const outcome = await engine.runSession({
      prompt,
      cwd: ctx.config.repo,
      resume,
      model: ctx.config.model,
      effort: ctx.config.effort,
      config: ctx.config,
      hooks: {
        onTool: (name, input) => {
          const detail = describeToolInput(input);
          this.log(ctx, "tool", { name, detail });
          this.progress(`🔧 ${name}${detail ? ` ${detail}` : ""}`);
        },
        onText: (text) => {
          this.log(ctx, "text", { text: text.slice(0, CONSTANTS.LOG_TEXT_MAX_LENGTH) });
          this.progress(`💬 ${oneLine(text)}`);
        },
        onModel: (reportedModel) => {
          if (reportedModel !== ctx.announcedModel) {
            ctx.announcedModel = reportedModel;
            this.say(ctx, `  model: ${reportedModel}`);
            this.log(ctx, "model", { model: reportedModel });
          }
        },
        log: (event, data) => this.log(ctx, event, data),
      },
    });

    enforceSessionBudget(outcome.costUsd, ctx.config.maxBudgetPerSessionUsd, "session");
    ctx.totalCostUsd += outcome.costUsd;
    const turnsInfo = outcome.turns !== undefined ? `${outcome.turns} turns, ` : "";
    const label = outcome.subtype ?? outcome.kind;
    this.say(
      ctx,
      `  session ${label}: ${turnsInfo}$${outcome.costUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)} (cascade total $${ctx.totalCostUsd.toFixed(CONSTANTS.DECIMAL_PLACES_USD)})`,
    );
    return outcome;
  }

  private async commitChanges(ctx: RunContext, message: string, extraExcludes: readonly string[] = []): Promise<void> {
    const excludes = [...new Set([...ctx.config.neverCommit, ...V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES, ...extraExcludes])].map(
      (path) => `:!${path}`,
    );
    await this.git(ctx, ["add", "-A", "--", ".", ...excludes]);
    if ((await this.git(ctx, ["diff", "--cached", "--quiet"])).code === CONSTANTS.EXIT_CODE_SUCCESS) {
      this.say(ctx, "  nothing to commit");
      return;
    }
    const { code, output } = await this.git(ctx, ["commit", "-m", message]);
    if (code !== CONSTANTS.EXIT_CODE_SUCCESS) {
      throw new Fatal(`git commit failed:\n${output.slice(-CONSTANTS.COMMIT_ERROR_OUTPUT_MAX_LENGTH)}`);
    }
    const sha = (await this.git(ctx, ["rev-parse", "--short", "HEAD"])).output;
    this.say(ctx, `  committed ${sha} ${message}`);
    this.log(ctx, "commit", { sha, message });
  }

  private async runTask(
    ctx: RunContext,
    change: string,
    tasksPath: string,
    task: Task,
    sectionCommit: boolean,
  ): Promise<void> {
    const verify = verifyCommands(task, ctx.config.fullGate, { repoRoot: ctx.config.repo, config: ctx.config });
    const commitType = commitTypeOf(task);
    if (ctx.lastVerifiedSha === undefined) {
      const head = await this.git(ctx, ["rev-parse", "HEAD"]);
      if (head.code === CONSTANTS.EXIT_CODE_SUCCESS) ctx.lastVerifiedSha = head.output.trim();
    }
    let verifiedThisTask = false;
    let prompt = taskPrompt(change, task, verify, sectionCommit, ctx.config.repo);
    if (ctx.directives.length > 0) {
      prompt = `${prompt}\n\n${formatRemediationDirectives(ctx.directives)}`;
    }
    let sessionId: string | undefined;
    let subject: string | undefined;
    let header: string | undefined;
    let attempts = 0;

    const rollbackBuffer = new RollbackStateBuffer({
      cwd: ctx.config.repo,
      excludes: [...ctx.config.neverCommit, ...V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES],
      timeoutMs: ctx.config.commandTimeoutMs,
      hooks: {
        say: (message) => this.say(ctx, message),
        log: (event, data) => this.log(ctx, event, data),
      },
    });
    await rollbackBuffer.snapshot();

    while (attempts < ctx.config.maxAttemptsPerTask) {
      enforceSessionBudget(ctx.totalCostUsd, ctx.config.maxTotalBudgetUsd, "total");
      await this.waitForUsageHeadroom(ctx);

      const outcome = await this.runSession(ctx, prompt, sessionId);
      if (outcome.kind === "fatal") throw new Fatal(outcome.reason);
      sessionId = outcome.sessionId ?? sessionId;

      if (outcome.kind === "paused") {
        await this.sleepUntil(ctx, outcome.resumeAt, "plan usage limit");
        prompt = `You were paused for plan usage limits. Continue task ${task.id} from the current working tree (inspect git diff first).`;
        continue;
      }
      attempts++;

      if (outcome.kind === "error") {
        this.say(ctx, `  session ended with ${outcome.reason} (attempt ${attempts}/${ctx.config.maxAttemptsPerTask})`);
        prompt = `The previous session stopped with "${outcome.reason}". Continue task ${task.id} from the current working tree.`;
        continue;
      }

      subject ??= outcome.result.match(/^COMMIT_SUBJECT:\s*(.+)$/m)?.[1]?.trim();
      header ??= outcome.result.match(/^COMMIT_MESSAGE:\s*(.+)$/m)?.[1]?.trim();
      const blocked = blockedReason(outcome.result);
      if (blocked) throw new Fatal(`Task ${task.id} needs a human decision: ${blocked}`);

      if (verify.length) {
        const checks = await selectVerifyChecks(verify, {
          cwd: ctx.config.repo,
          forceFull: ctx.config.fullGate || /\bfull verification\b/i.test(task.text),
          ignorePrefixes: V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES,
          baseRef: ctx.lastVerifiedSha,
          say: (message) => this.say(ctx, message),
          log: (event, data) => this.log(ctx, event, data),
        });
        const verification =
          checks.length > 0
            ? await runVerificationPhase({
                commands: checks,
                cwd: ctx.config.repo,
                taskId: task.id,
                attempt: attempts,
                maxAttempts: ctx.config.maxAttemptsPerTask,
                timeoutMs: ctx.config.commandTimeoutMs,
                hooks: {
                  say: (message) => this.say(ctx, message),
                  log: (event, data) => this.log(ctx, event, data),
                },
              })
            : { success: true, failures: [], feedbackPrompt: undefined };
        if (!verification.success) {
          this.say(ctx, `  checks failed (attempt ${attempts}/${ctx.config.maxAttemptsPerTask})`);
          ctx.selfImprover?.recordOutcome({
            source: "gate",
            change,
            taskId: task.id,
            outcome: "verification_failed",
            failureTrace: verification.feedbackPrompt,
            attempt: attempts,
          });
          prompt = verification.feedbackPrompt ?? prompt;
          continue;
        }
        markDone(tasksPath, task.id);
        verifiedThisTask = true;
      } else if (!readTasks(tasksPath).find((candidate) => candidate.id === task.id)?.done) {
        prompt = `Task ${task.id} is still unchecked in tasks.md. Finish it and mark it, or reply with "BLOCKED: <reason>".`;
        continue;
      }

      if (commitType) {
        const description = subject ?? task.section.replace(/^\d+\.\s*/, "");
        await this.commitChanges(ctx, `${commitType}: ${description}`.slice(0, CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH));
      } else if (sectionCommit) {
        const fallback = `chore(${change}): ${task.section.replace(/^\d+\.\s*/, "").toLowerCase()}`;
        await this.commitChanges(
          ctx,
          (header && CONSTANTS.CONVENTIONAL_HEADER_REGEX.test(header) ? header : fallback).slice(
            0,
            CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH,
          ),
        );
      }
      if (verifiedThisTask) {
        const head = await this.git(ctx, ["rev-parse", "HEAD"]);
        if (head.code === CONSTANTS.EXIT_CODE_SUCCESS) ctx.lastVerifiedSha = head.output.trim();
      }
      ctx.tasks.push({ change, taskId: task.id, status: "done", attempts });
      return;
    }

    if (ctx.config.rollbackOnFailure) {
      this.say(ctx, `  ⚠️ Task ${task.id} failed after ${attempts} attempts; executing git rollback buffer...`);
      const rollbackResult = await rollbackBuffer.rollback();
      ctx.rollbacks.push({
        change,
        taskId: task.id,
        success: rollbackResult.success,
        targetRef: rollbackResult.targetRef,
        error: rollbackResult.error,
      });
      if (rollbackResult.success) {
        this.say(ctx, `  ✅ Working tree rolled back to clean baseline (${rollbackResult.targetRef})`);
      } else {
        this.say(ctx, `  ❌ Working tree rollback failed: ${rollbackResult.error}`);
      }
    }

    ctx.tasks.push({ change, taskId: task.id, status: "failed", attempts });
    throw new TaskFailureError(task.id, change, attempts, ctx.logFile);
  }

  private async runChange(ctx: RunContext, changeReport: ChangeRunReport): Promise<string[]> {
    const change = changeReport.change;
    const tasksPath = this.tasksPath(ctx, change);
    if (!existsSync(tasksPath)) {
      changeReport.status = "missing";
      throw new Fatal(`${tasksPath} not found; create the change with ${OPENSPEC_PROPOSE_HINT} first`);
    }
    const skipped = new Set<string>();
    const initialTasks = readTasks(tasksPath);
    changeReport.pendingTasks = initialTasks.filter((task) => !task.done).length;
    const perSection = commitsPerSection(initialTasks);
    this.say(ctx, `=== ${change} === (${perSection ? "one commit per section" : "commit at tasks that name a type"})`);

    for (;;) {
      const task = readTasks(tasksPath).find((candidate) => !candidate.done && !skipped.has(candidate.id));
      if (!task) {
        await this.syncDiagramsIfEnabled(ctx, change);
        changeReport.status = "done";
        changeReport.pendingTasks = readTasks(tasksPath).filter((candidate) => !candidate.done).length;
        changeReport.skippedHumanTasks.push(...skipped);
        return [...skipped];
      }
      if (CONSTANTS.HUMAN_TASK_REGEX.test(task.text)) {
        skipped.add(task.id);
        ctx.tasks.push({ change, taskId: task.id, status: "skipped", attempts: 0 });
        this.say(ctx, `  skipping ${task.id} (human task): ${task.text.slice(0, CONSTANTS.TASK_SUMMARY_MAX_LENGTH)}`);
        continue;
      }
      this.say(ctx, `▶ ${change} ${task.id}: ${task.text.slice(0, CONSTANTS.TASK_SUMMARY_MAX_LENGTH)}`);
      this.log(ctx, "task_start", { change, id: task.id });
      try {
        await this.runTask(ctx, change, tasksPath, task, perSection && isLastOfSection(readTasks(tasksPath), task));
      } catch (error) {
        if (error instanceof TaskFailureError && ctx.config.resilient) {
          skipped.add(task.id);
          this.say(
            ctx,
            `  ⚠️ Resilient 24/7 mode: task ${task.id} failed after ${error.attempts} attempts and was rolled back; continuing.`,
          );
          this.log(ctx, "task_failure_resilient", {
            change,
            taskId: task.id,
            attempts: error.attempts,
            error: error.message,
          });
          continue;
        }
        changeReport.status = "failed";
        throw error;
      }
    }
  }

  private async syncDiagramsIfEnabled(ctx: RunContext, change: string): Promise<void> {
    if (!ctx.config.autoDiagrams) return;
    this.say(ctx, `🔄 Synchronizing diagrams for completed change: ${change}...`);
    const diagramResult = await syncDiagrams({
      cwd: ctx.config.repo,
      graphifyCommand: ctx.config.graphifyCommand,
      archifyBin: ctx.config.archifyBin,
      archifyAction: ctx.config.archifyAction,
      archifyQuality: ctx.config.archifyQuality,
      timeoutMs: CONSTANTS.DIAGRAM_SYNC_TIMEOUT_MS,
      hooks: {
        say: (message) => this.say(ctx, message),
        log: (event, data) => this.log(ctx, event, data),
      },
    });
    if (diagramResult.success) {
      this.say(ctx, `✅ Diagrams synchronized for ${change}`);
    } else {
      this.say(ctx, `⚠️ Diagram synchronization encountered warnings or failures for ${change}`);
    }
  }
}
