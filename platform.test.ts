import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  buildKeepAliveArgs,
  CAFFEINATE_BIN,
  CAFFEINATE_FLAG_IDLE,
  CAFFEINATE_FLAG_WAIT_PID,
  canRunSystemdInhibit,
  DEFAULT_SYSTEMD_INHIBIT_PATH,
  EXIT_CODE_SIGINT,
  EXIT_CODE_SIGTERM,
  findSystemdInhibit,
  isLinux,
  isMacOS,
  normalizePlatformPath,
  type ProcessSignalTarget,
  resolveBinaryInPath,
  startKeepAlive,
  SYSTEMD_INHIBIT_HOLD_COMMAND,
  SYSTEMD_INHIBIT_WHAT,
  SYSTEMD_INHIBIT_WHO,
  SYSTEMD_INHIBIT_WHY,
} from "./platform";

class MockProcessTarget extends EventEmitter implements ProcessSignalTarget {
  exitCalls: number[] = [];
  exit(code?: number) {
    this.exitCalls.push(code ?? 0);
  }
}

describe("OS abstraction helpers", () => {
  test("isMacOS checks darwin platform", () => {
    expect(isMacOS("darwin")).toBe(true);
    expect(isMacOS("linux")).toBe(false);
    expect(isMacOS("win32")).toBe(false);
  });

  test("isLinux checks linux platform", () => {
    expect(isLinux("linux")).toBe(true);
    expect(isLinux("darwin")).toBe(false);
    expect(isLinux("win32")).toBe(false);
  });

  test("normalizePlatformPath produces normalized resolved paths", () => {
    const raw = join("foo", "bar", "..", "baz");
    const normalized = normalizePlatformPath(raw);
    expect(normalized).not.toContain("..");
    expect(normalized.endsWith(join("foo", "baz"))).toBe(true);
  });

  test("resolveBinaryInPath locates executable in custom PATH", () => {
    // Current node or bun is in PATH
    const resolved = resolveBinaryInPath("bun", process.env.PATH);
    expect(resolved).not.toBeNull();
    expect(resolved?.endsWith("bun")).toBe(true);
  });

  test("resolveBinaryInPath returns null when binary is missing", () => {
    const resolved = resolveBinaryInPath("non_existent_binary_xyz_123", "/usr/bin:/bin");
    expect(resolved).toBeNull();
  });

  test("findSystemdInhibit returns path if present or null when missing in empty PATH", () => {
    const result = findSystemdInhibit("/nonexistent");
    // If the system has /usr/bin/systemd-inhibit, it returns default path; otherwise null
    if (result) {
      expect(result).toBe(DEFAULT_SYSTEMD_INHIBIT_PATH);
    } else {
      expect(result).toBeNull();
    }
  });

  test("canRunSystemdInhibit verifies command execution", () => {
    const mockSuccess = () => ({ exitCode: 0, success: true });
    const mockFailure = () => ({ exitCode: 1, success: false });
    const mockThrow = () => {
      throw new Error("EPERM");
    };

    expect(canRunSystemdInhibit("/usr/bin/systemd-inhibit", mockSuccess as any)).toBe(true);
    expect(canRunSystemdInhibit("/usr/bin/systemd-inhibit", mockFailure as any)).toBe(false);
    expect(canRunSystemdInhibit("/usr/bin/systemd-inhibit", mockThrow as any)).toBe(false);
  });
});

describe("buildKeepAliveArgs", () => {
  test("constructs caffeinate arguments for macOS", () => {
    const result = buildKeepAliveArgs({
      platform: "darwin",
      pid: 4242,
    });
    expect(result).not.toBeNull();
    expect(result?.mechanism).toBe("caffeinate");
    expect(result?.command).toEqual([
      CAFFEINATE_BIN,
      CAFFEINATE_FLAG_IDLE,
      CAFFEINATE_FLAG_WAIT_PID,
      "4242",
    ]);
  });

  test("constructs systemd-inhibit arguments for Linux", () => {
    const result = buildKeepAliveArgs({
      platform: "linux",
      pid: 4242,
      systemdInhibitPath: "/custom/bin/systemd-inhibit",
    });
    expect(result).not.toBeNull();
    expect(result?.mechanism).toBe("systemd-inhibit");
    expect(result?.command).toEqual([
      "/custom/bin/systemd-inhibit",
      `--what=${SYSTEMD_INHIBIT_WHAT}`,
      `--who=${SYSTEMD_INHIBIT_WHO}`,
      `--why=${SYSTEMD_INHIBIT_WHY}`,
      ...SYSTEMD_INHIBIT_HOLD_COMMAND,
    ]);
  });

  test("returns null for unsupported platforms", () => {
    const result = buildKeepAliveArgs({
      platform: "win32",
      pid: 4242,
    });
    expect(result).toBeNull();
  });
});

describe("startKeepAlive configuration & fallback", () => {
  test("returns disabled controller when enabled: false", () => {
    const mockTarget = new MockProcessTarget();
    const controller = startKeepAlive({
      enabled: false,
      processTarget: mockTarget,
    });

    expect(controller.active).toBe(false);
    expect(controller.mechanism).toBe("disabled");
    controller.stop();
    expect(controller.active).toBe(false);
    expect(mockTarget.listenerCount("SIGINT")).toBe(0);
  });

  test("defaults to noop-fallback on unsupported platforms without crashing", () => {
    const mockTarget = new MockProcessTarget();
    const controller = startKeepAlive({
      platform: "win32",
      processTarget: mockTarget,
    });

    expect(controller.active).toBe(true);
    expect(controller.mechanism).toBe("noop-fallback");
    controller.stop();
    expect(controller.active).toBe(false);
  });

  test("falls back to noop-fallback on Linux when systemd-inhibit is missing", () => {
    const mockTarget = new MockProcessTarget();
    const warnings: string[] = [];

    const controller = startKeepAlive({
      platform: "linux",
      systemdInhibitPath: null,
      processTarget: mockTarget,
      logWarning: (msg) => warnings.push(msg),
      spawnSync: () => ({ exitCode: 1 }),
    });

    // If system has systemd-inhibit in /usr/bin, but we override it via a failing check:
    // Let's force a scenario where inhibit binary is missing
    const missingController = startKeepAlive({
      platform: "linux",
      systemdInhibitPath: "/tmp/nonexistent-inhibit-binary-xyz",
      processTarget: mockTarget,
      logWarning: (msg) => warnings.push(msg),
      spawnSync: () => ({ exitCode: 1 }),
    });

    expect(missingController.active).toBe(true);
    expect(missingController.mechanism).toBe("noop-fallback");
    expect(warnings.length).toBeGreaterThan(0);
    missingController.stop();
  });

  test("falls back to noop-fallback on Linux when systemd-inhibit fails permission check", () => {
    const mockTarget = new MockProcessTarget();
    const warnings: string[] = [];

    const controller = startKeepAlive({
      platform: "linux",
      systemdInhibitPath: "/usr/bin/systemd-inhibit",
      processTarget: mockTarget,
      logWarning: (msg) => warnings.push(msg),
      spawnSync: () => ({ exitCode: 1, success: false }),
    });

    expect(controller.active).toBe(true);
    expect(controller.mechanism).toBe("noop-fallback");
    expect(warnings.some((w) => w.includes("permission check failed"))).toBe(true);
    controller.stop();
    expect(controller.active).toBe(false);
  });

  test("spawns caffeinate on macOS", () => {
    const mockTarget = new MockProcessTarget();
    let spawnedCmd: string[] = [];
    let killed = false;

    const controller = startKeepAlive({
      platform: "darwin",
      pid: 1234,
      processTarget: mockTarget,
      spawn: (cmd) => {
        spawnedCmd = cmd;
        return {
          kill: () => {
            killed = true;
          },
        };
      },
    });

    expect(controller.active).toBe(true);
    expect(controller.mechanism).toBe("caffeinate");
    expect(spawnedCmd).toEqual([
      CAFFEINATE_BIN,
      CAFFEINATE_FLAG_IDLE,
      CAFFEINATE_FLAG_WAIT_PID,
      "1234",
    ]);

    controller.stop();
    expect(controller.active).toBe(false);
    expect(killed).toBe(true);
  });

  test("spawns systemd-inhibit on Linux when available", () => {
    const mockTarget = new MockProcessTarget();
    let spawnedCmd: string[] = [];
    let killed = false;

    const controller = startKeepAlive({
      platform: "linux",
      pid: 5678,
      systemdInhibitPath: "/usr/bin/systemd-inhibit",
      processTarget: mockTarget,
      spawnSync: () => ({ exitCode: 0, success: true }),
      spawn: (cmd) => {
        spawnedCmd = cmd;
        return {
          kill: () => {
            killed = true;
          },
        };
      },
    });

    expect(controller.active).toBe(true);
    expect(controller.mechanism).toBe("systemd-inhibit");
    expect(spawnedCmd[0]).toBe("/usr/bin/systemd-inhibit");
    expect(spawnedCmd).toContain(`--what=${SYSTEMD_INHIBIT_WHAT}`);

    controller.stop();
    expect(controller.active).toBe(false);
    expect(killed).toBe(true);
  });

  test("falls back gracefully if caffeinate spawn throws", () => {
    const mockTarget = new MockProcessTarget();
    const warnings: string[] = [];

    const controller = startKeepAlive({
      platform: "darwin",
      processTarget: mockTarget,
      logWarning: (msg) => warnings.push(msg),
      spawn: () => {
        throw new Error("spawn ENOENT");
      },
    });

    expect(controller.active).toBe(true);
    expect(controller.mechanism).toBe("noop-fallback");
    expect(warnings.some((w) => w.includes("caffeinate failed to spawn"))).toBe(true);
    controller.stop();
  });
});

describe("signal handlers and lifecycle", () => {
  test("attaches and detaches listeners on SIGINT, SIGTERM, and exit", () => {
    const mockTarget = new MockProcessTarget();
    const controller = startKeepAlive({
      platform: "darwin",
      processTarget: mockTarget,
      spawn: () => ({ kill: () => {} }),
    });

    expect(mockTarget.listenerCount("SIGINT")).toBe(1);
    expect(mockTarget.listenerCount("SIGTERM")).toBe(1);
    expect(mockTarget.listenerCount("exit")).toBe(1);

    controller.stop();

    expect(mockTarget.listenerCount("SIGINT")).toBe(0);
    expect(mockTarget.listenerCount("SIGTERM")).toBe(0);
    expect(mockTarget.listenerCount("exit")).toBe(0);
  });

  test("calling stop() multiple times is idempotent", () => {
    let killCalls = 0;
    const mockTarget = new MockProcessTarget();

    const controller = startKeepAlive({
      platform: "darwin",
      processTarget: mockTarget,
      spawn: () => ({
        kill: () => {
          killCalls++;
        },
      }),
    });

    controller.stop();
    controller.stop();
    controller.stop();

    expect(killCalls).toBe(1);
    expect(controller.active).toBe(false);
  });

  test("SIGINT stops controller and exits with 130 when exitOnSignal is true", () => {
    let killed = false;
    const mockTarget = new MockProcessTarget();

    const controller = startKeepAlive({
      platform: "darwin",
      processTarget: mockTarget,
      exitOnSignal: true,
      spawn: () => ({
        kill: () => {
          killed = true;
        },
      }),
    });

    expect(controller.active).toBe(true);
    mockTarget.emit("SIGINT");

    expect(controller.active).toBe(false);
    expect(killed).toBe(true);
    expect(mockTarget.exitCalls).toEqual([EXIT_CODE_SIGINT]);
    expect(mockTarget.listenerCount("SIGINT")).toBe(0);
  });

  test("SIGTERM stops controller and exits with 143 when exitOnSignal is true", () => {
    let killed = false;
    const mockTarget = new MockProcessTarget();

    const controller = startKeepAlive({
      platform: "darwin",
      processTarget: mockTarget,
      exitOnSignal: true,
      spawn: () => ({
        kill: () => {
          killed = true;
        },
      }),
    });

    expect(controller.active).toBe(true);
    mockTarget.emit("SIGTERM");

    expect(controller.active).toBe(false);
    expect(killed).toBe(true);
    expect(mockTarget.exitCalls).toEqual([EXIT_CODE_SIGTERM]);
    expect(mockTarget.listenerCount("SIGTERM")).toBe(0);
  });

  test("exit event stops controller and terminates subprocess", () => {
    let killed = false;
    const mockTarget = new MockProcessTarget();

    const controller = startKeepAlive({
      platform: "darwin",
      processTarget: mockTarget,
      spawn: () => ({
        kill: () => {
          killed = true;
        },
      }),
    });

    expect(controller.active).toBe(true);
    mockTarget.emit("exit");

    expect(controller.active).toBe(false);
    expect(killed).toBe(true);
  });

  test("exitOnSignal: false prevents calling exit while still cleaning up", () => {
    let killed = false;
    const mockTarget = new MockProcessTarget();

    const controller = startKeepAlive({
      platform: "darwin",
      processTarget: mockTarget,
      exitOnSignal: false,
      spawn: () => ({
        kill: () => {
          killed = true;
        },
      }),
    });

    mockTarget.emit("SIGINT");
    expect(controller.active).toBe(false);
    expect(killed).toBe(true);
    expect(mockTarget.exitCalls.length).toBe(0);
  });

  test("real process integration with exitOnSignal: false", () => {
    const controller = startKeepAlive({
      exitOnSignal: false,
    });

    expect(controller.active).toBe(true);
    expect(["systemd-inhibit", "caffeinate", "noop-fallback"]).toContain(controller.mechanism);

    controller.stop();
    expect(controller.active).toBe(false);
  });
});
