/**
 * Node.js 24 LTS parity suite. Run with:
 *   node --import ./scripts/node_ts_register.mjs --test test/node/*.node.ts
 * Exercises the real production modules and the real CLI under Node (no Bun globals).
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../config";
import { auditFiles } from "../../src/audit/forensic";
import { ConfigValidationError } from "../../src/config/schemas";
import { CascadeFacade } from "../../src/facade/cascade_facade";
import { EngineFactory } from "../../src/pal/factory";
import { BunSpawner, createSpawner, detectRuntime, NodeSpawner, SpawnError } from "../../src/runtime";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTER_HOOK = join(ROOT, "scripts", "node_ts_register.mjs");
const CASCADE_ENTRY = join(ROOT, "cascade.ts");
const NODE_MAJOR_MINIMUM = 24;
const spawner = new NodeSpawner();

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await spawner.run(["git", ...args], { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
}

async function createRepoWithChange(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), "cascade-node24-"));
  await git(repo, ["init", "-q", "-b", "feat/node24"]);
  await git(repo, ["config", "user.email", "e2e@example.invalid"]);
  await git(repo, ["config", "user.name", "Cascade E2E"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  const changeDir = join(repo, "openspec", "changes", "node-parity");
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, "tasks.md"), "## 1. Parity\n- [ ] 1.1 Prove Node 24 parity\n");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-q", "-m", "chore: fixture"]);
  return repo;
}

function runCli(args: string[], cwd: string = ROOT): ReturnType<NodeSpawner["run"]> {
  const home = mkdtempSync(join(tmpdir(), "cascade-node24-home-"));
  return spawner.run([process.execPath, "--import", REGISTER_HOOK, CASCADE_ENTRY, ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: home, XDG_CACHE_HOME: join(home, ".cache") },
    timeoutMs: 60_000,
  });
}

describe("Node.js runtime", () => {
  test("runs on Node 24 LTS or newer without the Bun global", () => {
    assert.ok(Number(process.versions.node.split(".")[0]) >= NODE_MAJOR_MINIMUM);
    assert.equal(typeof (globalThis as { Bun?: unknown }).Bun, "undefined");
    assert.equal(detectRuntime(), "node");
    assert.ok(createSpawner() instanceof NodeSpawner);
  });
});

describe("NodeSpawner on Node", () => {
  test("collects output and exit codes", async () => {
    const result = await spawner.run(["sh", "-c", "printf out; printf err >&2; exit 3"]);
    assert.deepEqual(result, { exitCode: 3, stdout: "out", stderr: "err", timedOut: false, aborted: false });
  });

  test("times out with exit 124 and kills the process group", async () => {
    const result = await spawner.run(["sh", "-c", "sleep 30 & wait"], { timeoutMs: 200 });
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 124);
  });

  test("rejects missing binaries with SpawnError", async () => {
    await assert.rejects(spawner.spawn(["definitely-missing-binary-cascade"]).exitCode, SpawnError);
  });

  test("BunSpawner fails closed outside Bun", async () => {
    await assert.rejects(new BunSpawner().spawn(["true"]).exitCode, SpawnError);
  });
});

describe("production modules on Node", () => {
  test("config loader validates fail-closed", () => {
    assert.throws(() => loadConfig({ argv: ["--engine", "nope"], env: {} }), ConfigValidationError);
    assert.equal(loadConfig({ argv: ["--engine", "gemini"], env: {} }).engine, "antigravity");
  });

  test("EngineFactory builds every engine", () => {
    const factory = new EngineFactory({ spawner });
    for (const engine of ["claude", "opencode", "antigravity", "jules"]) {
      assert.equal(factory.create(engine).engineType, engine);
    }
  });

  test("CascadeFacade plans a dry run in a real git repository", async () => {
    const repo = await createRepoWithChange();
    try {
      const lines: string[] = [];
      const facade = new CascadeFacade({ spawner, output: { info: (line) => lines.push(line), error: (line) => lines.push(line) } });
      const config = loadConfig({
        argv: ["--repo", repo, "--changes", "node-parity", "--engine", "opencode", "--dry-run", "--no-keep-alive"],
        env: {},
        cwd: repo,
      });
      const result = await facade.run(config);
      assert.equal(result.exitCode, 0);
      assert.equal(result.changes[0]?.pendingTasks, 1);
      assert.ok(lines.join("\n").includes("node-parity: 1 pending"));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("forensic audit runs on Node", () => {
    assert.equal(auditFiles(ROOT, ["src/runtime"]).violations.length, 0);
  });
});

describe("cascade.ts CLI on Node", () => {
  test("--help exits 0", async () => {
    const result = await runCli(["--help"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("openspec-cascade"));
  });

  test("invalid engine exits 2", async () => {
    const result = await runCli(["--engine", "nope"]);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("STOPPED"));
  });

  test("--dry-run plans the change and exits 0", async () => {
    const repo = await createRepoWithChange();
    try {
      const result = await runCli(["--repo", repo, "--changes", "node-parity", "--engine", "jules", "--dry-run", "--no-keep-alive"]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes("node-parity: 1 pending"));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
