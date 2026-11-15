import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BunSpawner,
  NodeSpawner,
  SpawnError,
  createSpawner,
  detectRuntime,
  getDefaultSpawner,
  normalizeExitStatus,
  safelyKillProcess,
  setDefaultSpawner,
  shellArgv,
  toAdapterProcess,
  whichBinary,
  type ISpawner,
} from "../../src/runtime";
import { EXIT_CODE_CONSTANTS } from "../../src/config/constants";

const spawners: Array<[string, ISpawner]> = [
  ["BunSpawner", new BunSpawner()],
  ["NodeSpawner", new NodeSpawner()],
];

function processAlive(pid: number): boolean {
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

for (const [label, spawner] of spawners) {
  describe(`${label} contract`, () => {
    test("run collects stdout, stderr and exit code", async () => {
      const result = await spawner.run(["sh", "-c", "printf out; printf err >&2; exit 3"]);
      expect(result).toEqual({ exitCode: 3, stdout: "out", stderr: "err", timedOut: false, aborted: false });
    });

    test("passes cwd, env and stdin", async () => {
      const dir = mkdtempSync(join(tmpdir(), "cascade-spawner-"));
      try {
        const result = await spawner.run(["sh", "-c", 'pwd; printf "%s" "$CASCADE_PROBE"; cat'], {
          cwd: dir,
          env: { PATH: process.env.PATH, CASCADE_PROBE: "probe", IGNORED: undefined },
          stdin: "from-stdin",
        });
        expect(result.stdout).toContain(dir.split("/").at(-1) ?? dir);
        expect(result.stdout).toContain("probefrom-stdin");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("timeout kills the whole process group and reports 124", async () => {
      const dir = mkdtempSync(join(tmpdir(), "cascade-spawner-"));
      const pidFile = join(dir, "grandchild.pid");
      try {
        const result = await spawner.run(["sh", "-c", `sleep 30 & echo $! > ${pidFile}; wait`], { timeoutMs: 300 });
        expect(result.timedOut).toBe(true);
        expect(result.exitCode).toBe(EXIT_CODE_CONSTANTS.EXIT_CODE_TIMEOUT);
        const grandchild = Number((await Bun.file(pidFile).text()).trim());
        await spawner.sleep(100);
        expect(processAlive(grandchild)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("abort signal terminates the process", async () => {
      const controller = new AbortController();
      const running = spawner.run(["sleep", "30"], { abortSignal: controller.signal });
      setTimeout(() => controller.abort(), 100);
      const result = await running;
      expect(result.aborted).toBe(true);
      expect(result.exitCode).toBeGreaterThan(EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS);
    });

    test("already-aborted signal kills immediately", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await spawner.run(["sleep", "30"], { abortSignal: controller.signal });
      expect(result.aborted).toBe(true);
    });

    test("missing binary rejects with SpawnError ENOENT", async () => {
      const spawned = spawner.spawn(["definitely-missing-binary-cascade"]);
      const error = await spawned.exitCode.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SpawnError);
      expect((error as SpawnError).code).toBe("ENOENT");
    });

    test("empty argv throws SpawnError", () => {
      expect(() => spawner.spawn([])).toThrow(SpawnError);
    });

    test("ignored stdout yields an empty stream", async () => {
      const result = await spawner.run(["sh", "-c", "echo hidden"], { stdout: "ignore" });
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    test("kill() terminates a running process", async () => {
      const spawned = spawner.spawn(["sleep", "30"]);
      spawned.kill("SIGKILL");
      expect(await spawned.exitCode).toBe(137);
    });

    test("spawnSync returns output, exit code and handles missing binaries", () => {
      expect(spawner.spawnSync(["sh", "-c", "printf sync; exit 4"])).toEqual({ exitCode: 4, stdout: "sync", stderr: "" });
      expect(spawner.spawnSync(["cat"], { stdin: "in" }).stdout).toBe("in");
      expect(spawner.spawnSync(["definitely-missing-binary-cascade"]).exitCode).toBe(127);
    });

    test("spawnSync reports timeouts as 124", () => {
      expect(spawner.spawnSync(["sleep", "5"], { timeoutMs: 100 }).exitCode).toBe(EXIT_CODE_CONSTANTS.EXIT_CODE_TIMEOUT);
    });

    test("sleep resolves and rejects on abort", async () => {
      await spawner.sleep(5);
      const controller = new AbortController();
      const sleeping = spawner.sleep(10_000, controller.signal);
      controller.abort();
      await expect(sleeping).rejects.toThrow();
    });

    test("which resolves binaries on PATH", () => {
      expect(spawner.which("sh")).toMatch(/\/sh$/);
      expect(spawner.which("definitely-missing-binary-cascade")).toBeNull();
      expect(spawner.detectRuntime()).toBe("bun");
    });
  });
}

describe("runtime helpers", () => {
  test("shellArgv passes the command as one argument per platform", () => {
    expect(shellArgv("bun test", "linux")).toEqual(["sh", "-c", "bun test"]);
    expect(shellArgv("bun test; rm -rf /", "darwin")).toEqual(["sh", "-c", "bun test; rm -rf /"]);
    expect(shellArgv("bun test", "win32")).toEqual(["cmd.exe", "/d", "/s", "/c", "bun test"]);
  });

  test("normalizeExitStatus maps signals to 128 + n", () => {
    expect(normalizeExitStatus(0, null)).toBe(0);
    expect(normalizeExitStatus(null, "SIGKILL")).toBe(137);
    expect(normalizeExitStatus(null, "SIGTERM")).toBe(143);
    expect(normalizeExitStatus(null, null)).toBe(1);
    expect(normalizeExitStatus(null, "NOT_A_SIGNAL")).toBe(1);
  });

  test("safelyKillProcess returns false for missing processes", () => {
    expect(safelyKillProcess(undefined)).toBe(false);
    expect(safelyKillProcess(0)).toBe(false);
    expect(safelyKillProcess(2_147_483_000, "SIGTERM", { processGroup: false })).toBe(false);
  });

  test("whichBinary handles explicit paths, PATHEXT and empty input", () => {
    const dir = mkdtempSync(join(tmpdir(), "cascade-which-"));
    try {
      const tool = join(dir, "tool");
      writeFileSync(tool, "#!/bin/sh\n");
      chmodSync(tool, 0o755);
      const plain = join(dir, "plain");
      writeFileSync(plain, "");
      expect(whichBinary("tool", dir, "linux")).toBe(tool);
      expect(whichBinary(tool, "", "linux")).toBe(tool);
      expect(whichBinary("plain", dir, "linux")).toBeNull();
      expect(whichBinary("", dir, "linux")).toBeNull();
      writeFileSync(join(dir, "win.EXE"), "");
      expect(whichBinary("win", dir, "win32", ".EXE")).toBe(join(dir, "win.EXE"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("createSpawner, default spawner and adapter bridge", async () => {
    expect(detectRuntime()).toBe("bun");
    expect(createSpawner("node")).toBeInstanceOf(NodeSpawner);
    expect(createSpawner("bun")).toBeInstanceOf(BunSpawner);
    expect(createSpawner()).toBeInstanceOf(BunSpawner);
    const injected = new NodeSpawner();
    setDefaultSpawner(injected);
    expect(getDefaultSpawner()).toBe(injected);
    setDefaultSpawner(undefined);
    expect(getDefaultSpawner()).toBeInstanceOf(BunSpawner);
    const adapter = toAdapterProcess(getDefaultSpawner().spawn(["sh", "-c", "printf bridged"]));
    expect(await new Response(adapter.stdout).text()).toBe("bridged");
    expect(await adapter.exited).toBe(0);
    const sleeper = toAdapterProcess(getDefaultSpawner().spawn(["sleep", "30"]));
    sleeper.kill("SIGKILL");
    expect(await sleeper.exited).toBe(137);
  });
});
