import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type CascadeConfig } from "../../config";
import type { EngineOutcome, EngineSessionOptions } from "../../engine";
import { CascadeFacade, isFailClosedError, type CascadeOutput } from "../../src/facade";
import { Fatal } from "../../resilience";
import type { UnifiedEngine } from "../../src/pal/factory";
import type { IPalProvider } from "../../src/pal/types";
import { addOpenSpecChange, createTempGitRepo, runGitCommand, type TempGitRepo } from "../e2e/helpers/temp_repo";

const TASKS = ["## 1. Build", "- [ ] 1.1 Create the greeting module", ""].join("\n");

class WorkingEngine implements UnifiedEngine {
  readonly name = "opencode" as const;
  readonly engineType = "opencode" as const;
  readonly prompts: string[] = [];
  private readonly behavior: (options: EngineSessionOptions) => EngineOutcome;

  constructor(behavior: (options: EngineSessionOptions) => EngineOutcome) {
    this.behavior = behavior;
  }

  async runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    this.prompts.push(options.prompt);
    options.hooks.onText("working");
    options.hooks.onTool("Edit", { file_path: "greeting.ts" });
    return this.behavior(options);
  }

  getDefaultModel(): string {
    return "working-model";
  }

  supportsPlanMeters(): boolean {
    return false;
  }

  getProvider(): IPalProvider {
    throw new Error("unused");
  }
}

function completeTask(change: string) {
  return (options: EngineSessionOptions): EngineOutcome => {
    writeFileSync(join(options.cwd, "greeting.ts"), "export const greeting = \"hi\";\n");
    const tasksPath = join(options.cwd, "openspec", "changes", change, "tasks.md");
    writeFileSync(tasksPath, readFileSync(tasksPath, "utf8").replace("- [ ] 1.1", "- [x] 1.1"));
    return {
      kind: "done",
      sessionId: "session-1",
      result: "COMMIT_MESSAGE: feat(greeting): add greeting module",
      costUsd: 0.25,
    };
  };
}

function captureOutput(): CascadeOutput & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, info: (message) => lines.push(message), error: (message) => errors.push(message) };
}

function configFor(repo: TempGitRepo, change: string, overrides: Partial<CascadeConfig> = {}): CascadeConfig {
  return loadConfig({
    argv: ["--repo", repo.repoDir, "--changes", change, "--log-dir", repo.logDir, "--engine", "opencode"],
    env: {},
    cwd: repo.repoDir,
    overrides: { keepAlive: false, autoDiagrams: false, ...overrides },
  });
}

async function commitFixture(repo: TempGitRepo): Promise<void> {
  await runGitCommand(repo.repoDir, ["add", "-A"]);
  await runGitCommand(repo.repoDir, ["commit", "-m", "chore: add change fixture"]);
}

describe("CascadeFacade", () => {
  const repos: TempGitRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  async function freshRepo(): Promise<TempGitRepo> {
    const repo = await createTempGitRepo();
    repos.push(repo);
    addOpenSpecChange(repo.repoDir, "add-greeting", { tasksMarkdown: TASKS });
    await commitFixture(repo);
    return repo;
  }

  test("dry run plans pending tasks without logs, commits or engine sessions", async () => {
    const repo = await freshRepo();
    const engine = new WorkingEngine(completeTask("add-greeting"));
    const output = captureOutput();
    const facade = new CascadeFacade({ engine, output });
    const result = await facade.run(configFor(repo, "add-greeting,missing-change", { dryRun: true }));
    expect(result.exitCode).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.changes).toEqual([
      { change: "add-greeting", status: "planned", pendingTasks: 1, skippedHumanTasks: [] },
      { change: "missing-change", status: "missing", pendingTasks: 0, skippedHumanTasks: [] },
    ]);
    expect(result.logFile).toBeUndefined();
    expect(engine.prompts).toHaveLength(0);
    expect(output.lines.join("\n")).toContain("add-greeting: 1 pending");
    expect(output.lines.join("\n")).toContain("usage: unavailable");
    expect(existsSync(repo.logDir) ? readdirSync(repo.logDir) : []).toEqual([]);
    expect(facade.getKeepAliveController()?.mechanism).toBe("disabled");
  });

  test("executes a task, commits it, and reports telemetry and cost", async () => {
    const repo = await freshRepo();
    const engine = new WorkingEngine(completeTask("add-greeting"));
    const output = captureOutput();
    const result = await new CascadeFacade({ engine, output, resilience: false }).run(configFor(repo, "add-greeting"));
    expect(result.exitCode).toBe(0);
    expect(result.tasks).toEqual([{ change: "add-greeting", taskId: "1.1", status: "done", attempts: 1 }]);
    expect(result.changes[0]).toMatchObject({ status: "done", pendingTasks: 0 });
    expect(result.totalCostUsd).toBe(0.25);
    expect(result.telemetry).toMatchObject({ sessions: 1, outcomes: { done: 1 } });
    const log = await runGitCommand(repo.repoDir, ["log", "-1", "--pretty=%s"]);
    expect(log.stdout).toBe("feat(greeting): add greeting module");
    expect(result.logFile).toBeDefined();
    expect(readFileSync(result.logFile ?? "", "utf8")).toContain("\"event\":\"commit\"");
    expect(engine.prompts[0]).toContain("Implement ONLY task 1.1");
  });

  test("exhausted retries roll back the working tree and fail closed with exit 2", async () => {
    const repo = await freshRepo();
    const engine = new WorkingEngine((options) => {
      writeFileSync(join(options.cwd, "half-done.ts"), "export {};\n");
      return { kind: "error", sessionId: "s", reason: "exit 1: crashed", costUsd: 0 };
    });
    const output = captureOutput();
    const result = await new CascadeFacade({ engine, output, resilience: false }).run(
      configFor(repo, "add-greeting", { maxAttemptsPerTask: 2 }),
    );
    expect(result.exitCode).toBe(2);
    expect(result.errorKind).toBe("fail_closed");
    expect(result.rollbacks).toHaveLength(1);
    expect(result.rollbacks[0]?.success).toBe(true);
    expect(result.tasks).toEqual([{ change: "add-greeting", taskId: "1.1", status: "failed", attempts: 2 }]);
    expect(existsSync(join(repo.repoDir, "half-done.ts"))).toBe(false);
    expect(output.errors[0]).toContain("STOPPED: Task 1.1 of add-greeting failed after 2 attempts");
  });

  test("protected branches block real runs and dirty trees require --allow-dirty", async () => {
    const repo = await freshRepo();
    await runGitCommand(repo.repoDir, ["checkout", "-b", "main"]);
    const engine = new WorkingEngine(completeTask("add-greeting"));
    const blocked = await new CascadeFacade({ engine, output: captureOutput() }).run(configFor(repo, "add-greeting"));
    expect(blocked.exitCode).toBe(2);
    expect(blocked.error).toContain("main");
    await runGitCommand(repo.repoDir, ["checkout", "-b", "feat/dirty"]);
    writeFileSync(join(repo.repoDir, "stray.txt"), "stray\n");
    const dirty = await new CascadeFacade({ engine, output: captureOutput() }).run(configFor(repo, "add-greeting"));
    expect(dirty.exitCode).toBe(2);
    expect(dirty.error).toContain("Working tree is dirty");
    expect(engine.prompts).toHaveLength(0);
  });

  test("fatal engine outcomes stop the run and unexpected errors crash with exit 1", async () => {
    const repo = await freshRepo();
    const fatal = new WorkingEngine(() => ({ kind: "fatal", reason: "auth revoked", costUsd: 0 }));
    const stopped = await new CascadeFacade({ engine: fatal, output: captureOutput() }).run(configFor(repo, "add-greeting"));
    expect(stopped).toMatchObject({ exitCode: 2, error: "auth revoked" });
    const crashing = new WorkingEngine(() => {
      throw new TypeError("unexpected");
    });
    const output = captureOutput();
    const crashed = await new CascadeFacade({ engine: crashing, output, resilience: false }).run(
      configFor(repo, "add-greeting"),
    );
    expect(crashed).toMatchObject({ exitCode: 1, errorKind: "crash" });
    expect(output.errors[0]).toContain("CRASHED");
  });

  test("human tasks are skipped and reported", async () => {
    const repo = await createTempGitRepo();
    repos.push(repo);
    addOpenSpecChange(repo.repoDir, "human-only", { tasksMarkdown: "## 1. Ship\n- [ ] 1.1 Open the PR for review\n" });
    await commitFixture(repo);
    const result = await new CascadeFacade({ engine: new WorkingEngine(completeTask("human-only")), output: captureOutput() }).run(
      configFor(repo, "human-only"),
    );
    expect(result.exitCode).toBe(0);
    expect(result.changes[0]?.skippedHumanTasks).toEqual(["1.1"]);
    expect(result.tasks[0]).toMatchObject({ status: "skipped" });
  });

  test("buildEngine composes telemetry over the factory engine", () => {
    const repo = { repoDir: process.cwd() };
    const config = loadConfig({ argv: ["--repo", repo.repoDir, "--engine", "jules"], env: {}, cwd: repo.repoDir });
    const { engine, telemetry } = new CascadeFacade({ output: captureOutput() }).buildEngine(config);
    expect(engine).toBe(telemetry);
    expect(engine.engineType).toBe("jules");
    expect(isFailClosedError(new Fatal("x"))).toBe(true);
    expect(isFailClosedError(new Error("x"))).toBe(false);
  });
});
