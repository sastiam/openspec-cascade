import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type CascadeConfig } from "../../config";
import type { EngineOutcome, EngineSessionOptions } from "../../src/engine/contract";
import { CascadeFacade, type CascadeOutput } from "../../src/facade";
import { buildTaskDag, V2Pipeline } from "../../src/facade/v2_pipeline";
import type { UnifiedEngine } from "../../src/pal/factory";
import type { IPalProvider } from "../../src/pal/types";
import { MemoryStorage } from "../../src/storage/memory";
import { addOpenSpecChange, createTempGitRepo, runGitCommand, type TempGitRepo } from "../e2e/helpers/temp_repo";

const CHANGE = "add-greeting";
const TASKS = [
  "## 1. Implementation",
  "",
  "- [ ] 1.1 Implement deterministic core-behavior execution behavior. Verify: `bun --version`",
  "",
].join("\n");

class ScriptedWorker implements UnifiedEngine {
  readonly name = "opencode" as const;
  readonly engineType = "opencode" as const;
  readonly prompts: string[] = [];
  private readonly act: (options: EngineSessionOptions, call: number) => EngineOutcome;

  constructor(act: (options: EngineSessionOptions, call: number) => EngineOutcome) {
    this.act = act;
  }

  async runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    this.prompts.push(options.prompt);
    return this.act(options, this.prompts.length);
  }

  getDefaultModel(): string {
    return "scripted";
  }

  supportsPlanMeters(): boolean {
    return false;
  }

  getProvider(): IPalProvider {
    throw new Error("unused");
  }
}

function implementAndCheck(options: EngineSessionOptions): EngineOutcome {
  writeFileSync(
    join(options.cwd, "greeting.ts"),
    "const GREETING_PREFIX = \"Hello\";\n\nexport function greet(name: string): string {\n  return `${GREETING_PREFIX}, ${name}`;\n}\n",
  );
  const tasksPath = join(options.cwd, "openspec", "changes", CHANGE, "tasks.md");
  writeFileSync(tasksPath, readFileSync(tasksPath, "utf8").replace("- [ ] 1.1", "- [x] 1.1"));
  return { kind: "done", sessionId: "s-1", result: "done", costUsd: 0.1 };
}

function quietOutput(): CascadeOutput & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (line) => lines.push(line), error: (line) => lines.push(line) };
}

function config(repo: TempGitRepo, overrides: Partial<CascadeConfig> = {}): CascadeConfig {
  return loadConfig({
    argv: ["--repo", repo.repoDir, "--changes", CHANGE, "--log-dir", repo.logDir, "--engine", "opencode", "--mode", "v2"],
    env: {},
    cwd: repo.repoDir,
    overrides: { keepAlive: false, autoDiagrams: false, ...overrides },
  });
}

describe("V2Pipeline", () => {
  const repos: TempGitRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  async function freshRepo(tasks: string = TASKS): Promise<TempGitRepo> {
    const repo = await createTempGitRepo({ branch: "feat/v2" });
    repos.push(repo);
    addOpenSpecChange(repo.repoDir, CHANGE, { tasksMarkdown: tasks, includeConstitution: true });
    await runGitCommand(repo.repoDir, ["add", "-A"]);
    await runGitCommand(repo.repoDir, ["commit", "-m", "chore: change fixture"]);
    return repo;
  }

  test("buildTaskDag chains tasks sequentially", () => {
    const tasks = ["1.1", "1.2", "2.1"].map((id, line) => ({ id, done: false, text: id, section: "s", line }));
    const dag = buildTaskDag(tasks);
    expect(dag.topologicalSort()).toEqual(["1.1", "1.2", "2.1"]);
    expect(dag.getDependencies("2.1")).toEqual(["1.2"]);
  });

  test("drives a task through Gates 0-3 to a checkpoint commit and persists run state", async () => {
    const repo = await freshRepo();
    const engine = new ScriptedWorker(implementAndCheck);
    const result = await new CascadeFacade({ engine, output: quietOutput(), resilience: false }).run(config(repo));
    expect(result.exitCode).toBe(0);
    const report = result.v2Reports?.[0];
    expect(report?.finalState).toBe("STATE_COMPLETED");
    expect(report?.states).toEqual(
      expect.arrayContaining(["STATE_GATE_0_AUTO", "STATE_GATE_1_REVIEW", "STATE_GATE_2_CHALLENGE", "STATE_GATE_3_AUDIT", "STATE_COMMIT_CHECKPOINT", "STATE_VICTORY_AUDIT"]),
    );
    expect(result.tasks).toEqual([{ change: CHANGE, taskId: "1.1", status: "done", attempts: 1 }]);
    expect(engine.prompts[0]).toContain("OpenSpec change artifacts:");
    expect(engine.prompts[0]).toContain("Project constitution");
    const committed = await runGitCommand(repo.repoDir, ["show", "--name-only", "--pretty=%s", "HEAD"]);
    expect(committed.stdout.split("\n")[0]).toStartWith(`feat(${CHANGE}): 1.1`);
    expect(committed.stdout).toContain("greeting.ts");
    expect(committed.stdout).not.toContain(".agents/teamwork");
    expect(existsSync(join(repo.repoDir, ".agents", "teamwork"))).toBe(true);
    const state = await new MemoryStorage({ repoRoot: repo.repoDir }).readState<{ finalState: string }>(`cascade-v2-${CHANGE}`);
    expect(state?.finalState).toBe("STATE_COMPLETED");
  }, 60_000);

  test("retries Gate 0 failures with feedback, then rolls back and fails closed when exhausted", async () => {
    const repo = await freshRepo(TASKS.replace("`bun --version`", "`bun run definitely-missing-script`"));
    const engine = new ScriptedWorker(implementAndCheck);
    const output = quietOutput();
    const result = await new CascadeFacade({ engine, output, resilience: false }).run(config(repo, { maxAttemptsPerTask: 2 }));
    expect(result.exitCode).toBe(2);
    expect(engine.prompts).toHaveLength(2);
    expect(engine.prompts[1]).toContain("Feedback from the previous attempt");
    expect(result.rollbacks[0]).toMatchObject({ change: CHANGE, taskId: "1.1", success: true });
    expect(existsSync(join(repo.repoDir, "greeting.ts"))).toBe(false);
    const state = await new MemoryStorage({ repoRoot: repo.repoDir }).readState<{ states: string[]; finalState: string }>(`cascade-v2-${CHANGE}`);
    expect(state?.states).toEqual(expect.arrayContaining(["STATE_ESCALATE_DIAGNOSTIC", "STATE_ROLLBACK_RECOVERY"]));
    expect(state?.finalState).toBe("STATE_ABORTED");
  }, 60_000);

  test("Gate 3 vetoes cheating in new untracked files and nothing is committed", async () => {
    const repo = await freshRepo();
    const head = (await runGitCommand(repo.repoDir, ["rev-parse", "HEAD"])).stdout;
    const cheater = new ScriptedWorker((options) => {
      writeFileSync(join(options.cwd, "pay.ts"), 'export function pay(): number {\n  throw new Error("not implemented");\n}\n');
      writeFileSync(join(options.cwd, "pay.test.ts"), 'import { expect, test } from "bun:test";\ntest("ok", () => {\n  expect(true).toBe(true);\n});\n');
      const tasksPath = join(options.cwd, "openspec", "changes", CHANGE, "tasks.md");
      writeFileSync(tasksPath, readFileSync(tasksPath, "utf8").replace("- [ ] 1.1", "- [x] 1.1"));
      return { kind: "done", sessionId: "s", result: "done", costUsd: 0 };
    });
    const result = await new CascadeFacade({ engine: cheater, output: quietOutput(), resilience: false }).run(config(repo, { maxAttemptsPerTask: 1 }));
    expect(result.exitCode).toBe(2);
    expect((await runGitCommand(repo.repoDir, ["rev-parse", "HEAD"])).stdout).toBe(head);
    const state = await new MemoryStorage({ repoRoot: repo.repoDir }).readState<{ states: string[] }>(`cascade-v2-${CHANGE}`);
    expect(state?.states).toContain("STATE_GATE_3_AUDIT");
    expect(state?.states).not.toContain("STATE_COMMIT_CHECKPOINT");
    expect(existsSync(join(repo.repoDir, "pay.ts"))).toBe(false);
  }, 60_000);

  test("analyze blocks invalid changes before any session", async () => {
    const repo = await createTempGitRepo({ branch: "feat/v2" });
    repos.push(repo);
    addOpenSpecChange(repo.repoDir, CHANGE, { tasksMarkdown: TASKS, includeSpec: false, includeProposal: false });
    await runGitCommand(repo.repoDir, ["add", "-A"]);
    await runGitCommand(repo.repoDir, ["commit", "-m", "chore: broken fixture"]);
    const engine = new ScriptedWorker(implementAndCheck);
    const result = await new CascadeFacade({ engine, output: quietOutput() }).run(config(repo));
    expect(result.exitCode).toBe(2);
    expect(result.error).toContain("SDD analyze blocked");
    expect(engine.prompts).toHaveLength(0);
  });

  test("dry run prints the analyze verdict and DAG order without side effects", async () => {
    const repo = await freshRepo();
    const output = quietOutput();
    const engine = new ScriptedWorker(implementAndCheck);
    const result = await new CascadeFacade({ engine, output }).run(config(repo, { dryRun: true }));
    expect(result.exitCode).toBe(0);
    expect(output.lines.join("\n")).toContain("dag order: 1.1");
    expect(engine.prompts).toHaveLength(0);
    expect((await runGitCommand(repo.repoDir, ["status", "--porcelain"])).stdout).toBe("");
    const plan = await new V2Pipeline().plan(config(repo), CHANGE);
    expect(plan.analysis.passed).toBe(true);
  });
});
