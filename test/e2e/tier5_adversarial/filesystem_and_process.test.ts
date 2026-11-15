import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { EXIT_CODE_CONSTANTS } from "../../../src/config/constants";
import { HarnessInjector } from "../../../src/core/harness_injector";
import { GreptileCache, sha256 } from "../../../src/integration/greptile/cache";
import { ShadowCommitManager } from "../../../src/integration/greptile/shadow";
import { BunSpawner, NodeSpawner, type ISpawner } from "../../../src/runtime";
import { isProductionSourceFile } from "../../../src/sdd/sdd_gate";
import { runNodeScript } from "../helpers/cli_runner";
import { E2E_CONSTANTS } from "../helpers/constants";
import { cleanupTempDir, createTempGitRepo, runGitCommand, type TempGitRepo } from "../helpers/temp_repo";

const repos: TempGitRepo[] = [];
const dirs: string[] = [];
afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
  while (dirs.length > 0) cleanupTempDir(dirs.pop() ?? "");
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).charAt(0) !== "Z";
  } catch {
    return true;
  }
}

describe("Tier 5: filesystem escapes", () => {
  test("a symlink to a secret outside the repository is snapshotted as a link, never as the secret", async () => {
    const fixture = await createTempGitRepo({ branch: "feat/t5-symlink" });
    repos.push(fixture);
    const secret = join(fixture.homeDir, "secret.txt");
    writeFileSync(secret, "TOP-SECRET-CONTENT\n");
    symlinkSync(secret, join(fixture.repoDir, "innocent.txt"));
    await new ShadowCommitManager().withShadowCommit(fixture.repoDir, async (sha) => {
      const entry = await runGitCommand(fixture.repoDir, ["ls-tree", sha, "innocent.txt"]);
      expect(entry.stdout.startsWith("120000")).toBe(true);
      const blob = await runGitCommand(fixture.repoDir, ["show", `${sha}:innocent.txt`]);
      expect(blob.stdout).toBe(secret);
      expect(blob.stdout).not.toContain("TOP-SECRET-CONTENT");
    });
  });

  test("hostile cache queries cannot escape the content-addressed cache directory", () => {
    const root = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
    dirs.push(root);
    const cache = new GreptileCache<string>({ rootDir: root });
    const hostile = { baseSha: "../../../../etc", diffHash: sha256("x"), query: "../../passwd\u0000" };
    cache.set(hostile, "value");
    const files = readdirSync(cache.dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(relative(root, join(cache.dir, files[0] ?? "")).startsWith("..")).toBe(false);
    expect(cache.get(hostile)).toBe("value");
  });

  test("the harness refuses change ids that traverse outside openspec/changes", async () => {
    await expect(
      new HarnessInjector().buildExecutionContext({
        repoRoot: E2E_CONSTANTS.REPO_ROOT,
        changeId: "../../..",
        task: { id: "1.1", done: false, text: "x", section: "s", line: 0 },
      }),
    ).rejects.toThrow("Invalid change id");
  });

  test.each([["src/app.ts."], ["src/app.ts  "], ["SRC/APP.TS"], ["src\\app.ts"], ["test/../src/app.ts"]])(
    "SDD gate bypass attempt %p is blocked by the TypeScript gate and both plugin hooks",
    async (filePath) => {
      expect(isProductionSourceFile(filePath)).toBe(true);
      for (const hook of ["sdd_gate.mjs", "sdd_gate.cjs"]) {
        const result = await runNodeScript(join(E2E_CONSTANTS.REPO_ROOT, "plugins", "cascade", "hooks", hook), [], {
          stdin: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath }, cwd: join(tmpdir(), "no-such-repo") }),
        });
        expect(result.exitCode).toBe(EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL);
      }
    },
  );
});

const spawners: Array<[string, ISpawner]> = [
  ["BunSpawner", new BunSpawner()],
  ["NodeSpawner", new NodeSpawner()],
];

describe("Tier 5: process lifecycle", () => {
  for (const [label, spawner] of spawners) {
    test(`${label} escalates to SIGKILL for a SIGTERM-ignoring process tree and leaves no orphans`, async () => {
      const dir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
      dirs.push(dir);
      const pidFile = join(dir, "children.pid");
      const script = `trap '' TERM; (trap '' TERM; sleep 60) & echo $! > ${pidFile}; sleep 60 & echo $! >> ${pidFile}; wait`;
      const started = Date.now();
      const result = await spawner.run(["sh", "-c", script], { timeoutMs: 300 });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(EXIT_CODE_CONSTANTS.EXIT_CODE_TIMEOUT);
      expect(Date.now() - started).toBeLessThan(E2E_CONSTANTS.DEFAULT_SUBPROCESS_TIMEOUT_MS);
      await spawner.sleep(200);
      const children = readFileSync(pidFile, "utf8").trim().split("\n").map(Number);
      expect(children.length).toBe(2);
      for (const pid of children) expect(isAlive(pid)).toBe(false);
    }, 20_000);

    test(`${label} aborting mid-run kills the whole group`, async () => {
      const dir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_SANDBOX));
      dirs.push(dir);
      const pidFile = join(dir, "grandchild.pid");
      const controller = new AbortController();
      const running = spawner.run(["sh", "-c", `sleep 60 & echo $! > ${pidFile}; wait`], { abortSignal: controller.signal });
      await spawner.sleep(150);
      controller.abort();
      const result = await running;
      expect(result.aborted).toBe(true);
      await spawner.sleep(150);
      expect(existsSync(pidFile)).toBe(true);
      expect(isAlive(Number(readFileSync(pidFile, "utf8").trim()))).toBe(false);
    }, 20_000);
  }
});
