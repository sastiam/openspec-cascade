import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, type CascadeConfig } from "../../config";
import type { EngineOutcome, EngineSessionOptions } from "../../engine";
import { CascadeFacade, isFailClosedError, type CascadeOutput } from "../../src/facade";
import { Fatal } from "../../resilience";
import type { UnifiedEngine } from "../../src/pal/factory";
import type { V2Pipeline } from "../../src/facade/v2_pipeline";
import type { IPalProvider } from "../../src/pal/types";
import { addOpenSpecChange, createTempGitRepo, runGitCommand, type TempGitRepo } from "../e2e/helpers/temp_repo";

const TASKS = ["## 1. Build", "- [ ] 1.1 Create the greeting module", "  Verify: `bun run build`", ""].join("\n");

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
    writeFileSync(join(repo.repoDir, "package.json"), JSON.stringify({ scripts: { build: "echo built" } }));
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

  describe("manual steps in the final report", () => {
    const MANUAL = ["- Approve the release", "  Check: the release shows Approved", ""].join("\n");
    const STATUS_LINE = "add-greeting: done";
    const MANUAL_LINE = "  manual: Approve the release — check: the release shows Approved";

    async function finalReport(manualMarkdown?: string): Promise<string[]> {
      const repo = await createTempGitRepo();
      repos.push(repo);
      writeFileSync(join(repo.repoDir, "package.json"), JSON.stringify({ scripts: { build: "echo built" } }));
      addOpenSpecChange(repo.repoDir, "add-greeting", { tasksMarkdown: TASKS });
      if (manualMarkdown !== undefined) {
        writeFileSync(join(repo.repoDir, "openspec", "changes", "add-greeting", "manual.md"), manualMarkdown);
      }
      await commitFixture(repo);
      const output = captureOutput();
      const result = await new CascadeFacade({
        engine: new WorkingEngine(completeTask("add-greeting")),
        output,
        resilience: false,
      }).run(configFor(repo, "add-greeting"));
      expect(result.exitCode).toBe(0);
      const finished = output.lines.find((line) => line.includes("Cascade finished"));
      return (finished ?? "").split("\n");
    }

    test("a change with manual.md lists its steps right after the status line", async () => {
      const lines = await finalReport(MANUAL);
      const statusIndex = lines.indexOf(STATUS_LINE);
      expect(statusIndex).toBeGreaterThan(-1);
      expect(lines[statusIndex + 1]).toBe(MANUAL_LINE);
    });

    test("a change without manual.md gets no manual line", async () => {
      const lines = await finalReport();
      expect(lines).toContain(STATUS_LINE);
      expect(lines.some((line) => line.includes("manual:"))).toBe(false);
    });
  });

  describe("docs-only fast-track", () => {
    const VERIFY_TASKS = ["## 1. Build", "- [ ] 1.1 Update the greeting.", "  Verify: `bun run build`", ""].join("\n");

    async function repoWithBuildScript(): Promise<TempGitRepo> {
      const repo = await createTempGitRepo();
      repos.push(repo);
      writeFileSync(join(repo.repoDir, "package.json"), JSON.stringify({ scripts: { build: "echo built" } }));
      addOpenSpecChange(repo.repoDir, "add-greeting", { tasksMarkdown: VERIFY_TASKS });
      await commitFixture(repo);
      return repo;
    }

    function touching(file: string, change: string) {
      return (options: EngineSessionOptions): EngineOutcome => {
        mkdirSync(dirname(join(options.cwd, file)), { recursive: true });
        writeFileSync(join(options.cwd, file), "content\n");
        const tasksPath = join(options.cwd, "openspec", "changes", change, "tasks.md");
        writeFileSync(tasksPath, readFileSync(tasksPath, "utf8").replace("- [ ] 1.1", "- [x] 1.1"));
        return { kind: "done", sessionId: "s", result: "COMMIT_MESSAGE: docs(greeting): update", costUsd: 0 };
      };
    }

    test("skips the build check when the task only touched documentation", async () => {
      const repo = await repoWithBuildScript();
      const output = captureOutput();
      const engine = new WorkingEngine(touching("docs/guide.md", "add-greeting"));
      const result = await new CascadeFacade({ engine, output, resilience: false }).run(configFor(repo, "add-greeting"));
      expect(result.exitCode).toBe(0);
      expect(result.tasks).toEqual([{ change: "add-greeting", taskId: "1.1", status: "done", attempts: 1 }]);
      const text = output.lines.join("\n");
      expect(text).toContain("fast-track");
      expect(text).not.toContain("check: bun run build");
    });

    test("fast-tracks a docs task after a verified code task (commit-per-task mode)", async () => {
      const repo = await createTempGitRepo();
      repos.push(repo);
      writeFileSync(join(repo.repoDir, "package.json"), JSON.stringify({ scripts: { build: "echo built" } }));
      const tasks = [
        "## 1. Build",
        "- [ ] 1.1 Implement the parser. Commit `feat`",
        "  Verify: `bun run build`",
        "- [ ] 1.2 Update the guide. Commit `docs`",
        "  Verify: `bun run build`",
        "",
      ].join("\n");
      addOpenSpecChange(repo.repoDir, "add-greeting", { tasksMarkdown: tasks });
      await commitFixture(repo);
      const output = captureOutput();
      const engine = new WorkingEngine((options) => {
        const first = options.prompt.includes("task 1.1");
        const file = first ? "src/parser.ts" : "docs/guide.md";
        mkdirSync(dirname(join(options.cwd, file)), { recursive: true });
        writeFileSync(join(options.cwd, file), "content\n");
        const tasksPath = join(options.cwd, "openspec", "changes", "add-greeting", "tasks.md");
        const id = first ? "1.1" : "1.2";
        writeFileSync(tasksPath, readFileSync(tasksPath, "utf8").replace(`- [ ] ${id}`, `- [x] ${id}`));
        return { kind: "done", sessionId: "s", result: "COMMIT_SUBJECT: update", costUsd: 0 };
      });
      const result = await new CascadeFacade({ engine, output, resilience: false }).run(configFor(repo, "add-greeting"));
      expect(result.exitCode).toBe(0);
      expect(result.tasks.map((t) => t.status)).toEqual(["done", "done"]);
      const text = output.lines.join("\n");
      expect(text).toContain("check: bun run build");
      expect(text).toContain("fast-track");
    });

    test("still runs the build check when the task touched code", async () => {
      const repo = await repoWithBuildScript();
      const output = captureOutput();
      const engine = new WorkingEngine(touching("src/greeting.ts", "add-greeting"));
      const result = await new CascadeFacade({ engine, output, resilience: false }).run(configFor(repo, "add-greeting"));
      expect(result.exitCode).toBe(0);
      const text = output.lines.join("\n");
      expect(text).toContain("check: bun run build");
      expect(text).not.toContain("fast-track");
    });
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

  test("--settings must exist and is reported in the preflight banner", async () => {
    const repo = await freshRepo();
    const engine = new WorkingEngine(completeTask("add-greeting"));
    const missing = await new CascadeFacade({ engine, output: captureOutput() }).run(
      configFor(repo, "add-greeting", { dryRun: true, settings: join(repo.homeDir, "missing.settings.json") }),
    );
    expect(missing.exitCode).toBe(2);
    expect(missing.error).toContain("--settings file not found");
    const settingsFile = join(repo.homeDir, "sandbox.settings.json");
    writeFileSync(settingsFile, JSON.stringify({ sandbox: { enabled: true } }));
    const output = captureOutput();
    const ok = await new CascadeFacade({ engine, output }).run(configFor(repo, "add-greeting", { dryRun: true, settings: settingsFile }));
    expect(ok.exitCode).toBe(0);
    expect(output.lines.join("\n")).toContain(`settings=${settingsFile}`);
    expect(output.lines.join("\n")).toContain("--settings applies to the Claude engine only");
  });

  test("human tasks are skipped and reported", async () => {
    const repo = await createTempGitRepo();
    repos.push(repo);
    addOpenSpecChange(repo.repoDir, "human-only", { tasksMarkdown: "## 1. Ship\n- [ ] 1.1 Open the PR for review\n  Verify: the pull request exists\n" });
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

  describe("tasks.md lint preflight", () => {
    const UNVERIFIED = ["## 1. Build", "- [ ] 1.1 Create the greeting module", ""].join("\n");
    const VERIFIED = ["## 1. Build", "- [ ] 1.1 Create the greeting module", "  Verify: `bun run build`", ""].join("\n");

    async function repoWith(changes: Record<string, string>): Promise<TempGitRepo> {
      const repo = await createTempGitRepo();
      repos.push(repo);
      writeFileSync(join(repo.repoDir, "package.json"), JSON.stringify({ scripts: { build: "echo built" } }));
      for (const [change, tasksMarkdown] of Object.entries(changes)) addOpenSpecChange(repo.repoDir, change, { tasksMarkdown });
      await commitFixture(repo);
      return repo;
    }

    test("a finding stops the run before any engine session", async () => {
      const repo = await repoWith({ bad: UNVERIFIED });
      const engine = new WorkingEngine(completeTask("bad"));
      const result = await new CascadeFacade({ engine, output: captureOutput() }).run(configFor(repo, "bad"));
      expect(result.exitCode).toBe(2);
      expect(result.errorKind).toBe("fail_closed");
      expect(result.error).toContain("bad: tasks.md:2: missing-verify");
      expect(engine.prompts).toHaveLength(0);
    });

    test("a manual.md finding stops the run before any engine session", async () => {
      const repo = await createTempGitRepo();
      repos.push(repo);
      writeFileSync(join(repo.repoDir, "package.json"), JSON.stringify({ scripts: { build: "echo built" } }));
      addOpenSpecChange(repo.repoDir, "demo", { tasksMarkdown: VERIFIED });
      writeFileSync(join(repo.repoDir, "openspec", "changes", "demo", "manual.md"), "- Approve the release\n");
      await commitFixture(repo);
      const engine = new WorkingEngine(completeTask("demo"));
      const result = await new CascadeFacade({ engine, output: captureOutput() }).run(configFor(repo, "demo"));
      expect(result.exitCode).toBe(2);
      expect(result.errorKind).toBe("fail_closed");
      expect(result.error).toStartWith("lint-tasks failed; fix these findings before running:");
      expect(result.error).toContain(
        "demo: manual.md:1: missing-check step has no indented Check: line with text; add one under the step",
      );
      expect(engine.prompts).toHaveLength(0);
    });

    test("findings of every listed change are reported, grouped by change", async () => {
      const repo = await repoWith({ a: UNVERIFIED, b: UNVERIFIED });
      const result = await new CascadeFacade({ engine: new WorkingEngine(completeTask("a")), output: captureOutput() }).run(
        configFor(repo, "a,b"),
      );
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain("a: tasks.md:2: missing-verify");
      expect(result.error).toContain("b: tasks.md:2: missing-verify");
    });

    test("a finding in the second change stops the run before the first change starts", async () => {
      const repo = await repoWith({ good: VERIFIED, bad: UNVERIFIED });
      const engine = new WorkingEngine(completeTask("good"));
      const result = await new CascadeFacade({ engine, output: captureOutput() }).run(configFor(repo, "good,bad"));
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain("bad: tasks.md");
      expect(engine.prompts).toHaveLength(0);
      expect(readFileSync(join(repo.repoDir, "openspec", "changes", "good", "tasks.md"), "utf8")).toContain("- [ ] 1.1");
    });

    test("the v2 pipeline stops on a finding too", async () => {
      const repo = await repoWith({ bad: UNVERIFIED });
      const pipelineCalls: string[] = [];
      const v2Pipeline = {
        plan: async () => {
          pipelineCalls.push("plan");
          throw new Error("unexpected");
        },
        runChange: async () => {
          pipelineCalls.push("runChange");
          throw new Error("unexpected");
        },
      } as unknown as V2Pipeline;
      const result = await new CascadeFacade({ engine: new WorkingEngine(completeTask("bad")), output: captureOutput(), v2Pipeline }).run(
        configFor(repo, "bad", { mode: "v2" }),
      );
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain("bad: tasks.md:2: missing-verify");
      expect(pipelineCalls).toEqual([]);
    });

    test("a dry run does not lint and prints its plan", async () => {
      const repo = await repoWith({ bad: UNVERIFIED });
      const output = captureOutput();
      const result = await new CascadeFacade({ engine: new WorkingEngine(completeTask("bad")), output }).run(
        configFor(repo, "bad", { dryRun: true }),
      );
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeUndefined();
      expect(output.lines.join("\n")).toContain("bad: 1 pending");
      expect(output.errors.join("\n")).not.toContain("missing-verify");
    });

    test("a change that was not listed is not linted", async () => {
      const repo = await repoWith({ good: VERIFIED, bad: UNVERIFIED });
      const result = await new CascadeFacade({ engine: new WorkingEngine(completeTask("good")), output: captureOutput(), resilience: false }).run(
        configFor(repo, "good"),
      );
      expect(result.exitCode).toBe(0);
      expect(result.changes[0]).toMatchObject({ change: "good", status: "done" });
    });

    test("a listed change without tasks.md is left to the existing missing-file handling", async () => {
      const repo = await repoWith({ good: VERIFIED });
      const result = await new CascadeFacade({ engine: new WorkingEngine(completeTask("good")), output: captureOutput() }).run(
        configFor(repo, "absent"),
      );
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain("not found");
      expect(result.error).not.toContain("missing-verify");
    });
  });
});

describe("alwaysVerify", () => {
  const SUCCESS_EXIT_CODE = 0;
  const FAIL_CLOSED_EXIT_CODE = 2;
  const SCRIPTS = { "arch:check": "echo ok", "unit:check": "echo ok", "smoke:test": "echo ok" };
  const UNIT_CHECK = "bun run unit:check";
  const ARCH_CHECK = "bun run arch:check";
  const TASK_A = ["## 1. Build", "- [ ] 1.1 Create the greeting module", `  Verify: \`${UNIT_CHECK}\` passes`, ""].join("\n");
  const TASK_B = [
    "## 1. Build",
    "- [ ] 1.1 Run `bun test test/a.test.ts` and see it fail.",
    `  Verify: \`${UNIT_CHECK}\` passes`,
    "",
  ].join("\n");
  const TASK_C = ["## 1. Build", "- [ ] 1.1 Run full verification.", "  Verify: `bun run smoke:test` passes", ""].join("\n");
  const repos: TempGitRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  async function repoWith(tasksMarkdown: string): Promise<TempGitRepo> {
    const repo = await createTempGitRepo();
    repos.push(repo);
    writeFileSync(join(repo.repoDir, "package.json"), JSON.stringify({ scripts: SCRIPTS }));
    addOpenSpecChange(repo.repoDir, "add-greeting", { tasksMarkdown });
    await commitFixture(repo);
    return repo;
  }

  function hasLine(output: { lines: string[] }, text: string): boolean {
    return output.lines.some((line) => line.includes(text));
  }

  function notesOnly(options: EngineSessionOptions): EngineOutcome {
    writeFileSync(join(options.cwd, "NOTES.md"), "notes\n");
    const tasksPath = join(options.cwd, "openspec", "changes", "add-greeting", "tasks.md");
    writeFileSync(tasksPath, readFileSync(tasksPath, "utf8").replace("- [ ] 1.1", "- [x] 1.1"));
    return { kind: "done", sessionId: "s", result: "COMMIT_MESSAGE: docs(notes): add notes", costUsd: 0 };
  }

  test("Architecture check on a task with Verify", async () => {
    const repo = await repoWith(TASK_A);
    const dryOutput = captureOutput();
    await new CascadeFacade({ engine: new WorkingEngine(completeTask("add-greeting")), output: dryOutput, resilience: false }).run(
      configFor(repo, "add-greeting", { alwaysVerify: [ARCH_CHECK], dryRun: true }),
    );
    expect(dryOutput.lines.some((line) => line.includes(`verify=[${UNIT_CHECK} | ${ARCH_CHECK}]`))).toBe(true);

    const engine = new WorkingEngine(completeTask("add-greeting"));
    const output = captureOutput();
    const result = await new CascadeFacade({ engine, output, resilience: false }).run(
      configFor(repo, "add-greeting", { alwaysVerify: [ARCH_CHECK] }),
    );
    expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
    expect(hasLine(output, `  check: ${UNIT_CHECK}`)).toBe(true);
    expect(output.lines.filter((line) => line.endsWith(`  check: ${ARCH_CHECK}`))).toHaveLength(1);
    expect(engine.prompts[0]).toContain(ARCH_CHECK);
    expect(engine.prompts[0]).toContain(UNIT_CHECK);
  });

  test("Nothing to report writes no verify_ignored event (regression guard)", async () => {
    const repo = await repoWith(TASK_A);
    const result = await new CascadeFacade({
      engine: new WorkingEngine(completeTask("add-greeting")),
      output: captureOutput(),
      resilience: false,
    }).run(configFor(repo, "add-greeting", { alwaysVerify: [] }));
    expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
    expect(readFileSync(result.logFile ?? "", "utf8")).not.toContain('"event":"verify_ignored"');
  });

  test("Command before the marker is reported", async () => {
    const repo = await repoWith(TASK_B);
    const dryOutput = captureOutput();
    await new CascadeFacade({ engine: new WorkingEngine(completeTask("add-greeting")), output: dryOutput, resilience: false }).run(
      configFor(repo, "add-greeting", { alwaysVerify: [], dryRun: true }),
    );
    expect(dryOutput.lines.some((line) => line.includes(`verify=[${UNIT_CHECK}] ignored=[bun test test/a.test.ts]`))).toBe(true);

    const output = captureOutput();
    const result = await new CascadeFacade({
      engine: new WorkingEngine(completeTask("add-greeting")),
      output,
      resilience: false,
    }).run(configFor(repo, "add-greeting", { alwaysVerify: [] }));
    expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
    expect(output.lines.some((line) => line.includes("check: bun test test/a.test.ts"))).toBe(false);
    const events = readFileSync(result.logFile ?? "", "utf8")
      .split("\n")
      .filter((line) => line.includes('"event":"verify_ignored"'));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('"taskId":"1.1"');
    expect(events[0]).toContain('"commands":["bun test test/a.test.ts"]');
  });

  test("Empty setting (regression guard)", async () => {
    const repo = await repoWith(TASK_A);
    const output = captureOutput();
    const result = await new CascadeFacade({
      engine: new WorkingEngine(completeTask("add-greeting")),
      output,
      resilience: false,
    }).run(configFor(repo, "add-greeting", { alwaysVerify: [] }));
    expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
    expect(hasLine(output, `  check: ${UNIT_CHECK}`)).toBe(true);
    expect(output.lines.some((line) => line.includes("arch:check"))).toBe(false);
  });

  test("Full verification keeps every check (regression guard)", async () => {
    const repo = await repoWith(TASK_C);
    const output = captureOutput();
    const result = await new CascadeFacade({ engine: new WorkingEngine(notesOnly), output, resilience: false }).run(
      configFor(repo, "add-greeting", { alwaysVerify: [] }),
    );
    expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
    expect(hasLine(output, "  check: bun run smoke:test")).toBe(true);
    expect(output.lines.some((line) => line.includes("fast-track"))).toBe(false);
  });

  async function repoWithFailingArchCheck(): Promise<TempGitRepo> {
    const repo = await createTempGitRepo();
    repos.push(repo);
    writeFileSync(join(repo.repoDir, "package.json"), JSON.stringify({ scripts: { ...SCRIPTS, "arch:check": "exit 1" } }));
    addOpenSpecChange(repo.repoDir, "add-greeting", { tasksMarkdown: TASK_A });
    await commitFixture(repo);
    return repo;
  }

  test("Baseline fails", async () => {
    const repo = await repoWithFailingArchCheck();
    const engine = new WorkingEngine(completeTask("add-greeting"));
    const result = await new CascadeFacade({ engine, output: captureOutput(), resilience: false }).run(
      configFor(repo, "add-greeting", { alwaysVerify: [ARCH_CHECK] }),
    );
    expect(result.exitCode).toBe(FAIL_CLOSED_EXIT_CODE);
    expect(result.errorKind).toBe("fail_closed");
    expect(engine.prompts).toHaveLength(0);
    expect(result.error).toContain(ARCH_CHECK);
  });

  test("Baseline passes (regression guard)", async () => {
    const repo = await repoWith(TASK_A);
    const result = await new CascadeFacade({
      engine: new WorkingEngine(completeTask("add-greeting")),
      output: captureOutput(),
      resilience: false,
    }).run(configFor(repo, "add-greeting", { alwaysVerify: [ARCH_CHECK] }));
    expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
    expect(readFileSync(join(repo.repoDir, "openspec", "changes", "add-greeting", "tasks.md"), "utf8")).toContain("- [x] 1.1");
  });

  test("Dry run (regression guard)", async () => {
    const repo = await repoWithFailingArchCheck();
    const engine = new WorkingEngine(completeTask("add-greeting"));
    const result = await new CascadeFacade({ engine, output: captureOutput(), resilience: false }).run(
      configFor(repo, "add-greeting", { alwaysVerify: [ARCH_CHECK], dryRun: true }),
    );
    expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
    expect(engine.prompts).toHaveLength(0);
  });
});
