import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONSTANTS } from "./config";
import {
  buildArchifyCommand,
  discoverArchifyTargets,
  resolveArchifyBin,
  syncDiagrams,
  type ArchifyTarget,
} from "./diagrams";
import type { CommandRunnerResult } from "./qa";

describe("discoverArchifyTargets", () => {
  test("returns empty array when repo has no .archify directory", () => {
    const targets = discoverArchifyTargets("/non/existent/path/repo");
    expect(targets).toEqual([]);
  });

  test("discovers valid candidate.json in subdirectories of .archify", () => {
    const tempDir = join("/tmp", `test-archify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const subDir = join(tempDir, ".archify", "my-architecture");
    mkdirSync(subDir, { recursive: true });

    const candidate = {
      diagram_type: "architecture",
      meta: {
        output: "custom-arch.html",
        quality_profile: "showcase",
      },
    };
    writeFileSync(join(subDir, "candidate.json"), JSON.stringify(candidate));

    const targets = discoverArchifyTargets(tempDir);
    expect(targets.length).toBe(1);
    expect(targets[0]?.name).toBe("my-architecture");
    expect(targets[0]?.diagramType).toBe("architecture");
    expect(targets[0]?.outputPath).toBe(join(subDir, "custom-arch.html"));
    expect(targets[0]?.quality).toBe("showcase");

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("discovers candidate.archify.md and maps to explainer diagram", () => {
    const tempDir = join("/tmp", `test-archify-md-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const subDir = join(tempDir, ".archify", "system-overview");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "candidate.archify.md"), "# System Overview");

    const targets = discoverArchifyTargets(tempDir);
    expect(targets.length).toBe(1);
    expect(targets[0]?.name).toBe("system-overview");
    expect(targets[0]?.diagramType).toBe("explainer");
    expect(targets[0]?.outputPath).toBe(join(subDir, "system-overview.html"));

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("handles corrupted candidate.json gracefully without crashing", () => {
    const tempDir = join("/tmp", `test-archify-bad-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const subDir = join(tempDir, ".archify", "broken-diag");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "candidate.json"), "invalid json content { [");

    const targets = discoverArchifyTargets(tempDir);
    expect(targets).toEqual([]);

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("discovers root .archify/candidate.json if present", () => {
    const tempDir = join("/tmp", `test-archify-root-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const archifyDir = join(tempDir, ".archify");
    mkdirSync(archifyDir, { recursive: true });

    const candidate = {
      diagram_type: "workflow",
      meta: {
        output: "root-workflow.html",
        quality_profile: "standard",
      },
    };
    writeFileSync(join(archifyDir, "candidate.json"), JSON.stringify(candidate));

    const targets = discoverArchifyTargets(tempDir);
    expect(targets.length).toBe(1);
    expect(targets[0]?.name).toBe("root");
    expect(targets[0]?.diagramType).toBe("workflow");
    expect(targets[0]?.outputPath).toBe(join(archifyDir, "root-workflow.html"));
    expect(targets[0]?.quality).toBe("standard");

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("discovers existing architecture diagram in openspec-cascade repository", () => {
    const targets = discoverArchifyTargets(process.cwd());
    const match = targets.find((t) => t.name === "architecture-openspec-cascade");
    expect(match).toBeDefined();
    expect(match?.diagramType).toBe("architecture");
    expect(match?.quality).toBe("showcase");
    expect(match?.outputPath).toContain("openspec-cascade-architecture.html");
  });
});

describe("resolveArchifyBin & buildArchifyCommand", () => {
  test("resolveArchifyBin respects custom bin argument", () => {
    expect(resolveArchifyBin("/custom/archify")).toBe("/custom/archify");
  });

  test("resolveArchifyBin respects environment variables", () => {
    const original = process.env.ARCHIFY_BIN;
    try {
      process.env.ARCHIFY_BIN = "/env/bin/archify";
      expect(resolveArchifyBin()).toBe("/env/bin/archify");
    } finally {
      if (original) {
        process.env.ARCHIFY_BIN = original;
      } else {
        delete process.env.ARCHIFY_BIN;
      }
    }
  });

  test("buildArchifyCommand builds deliver command with JSON output and quality", () => {
    const target: ArchifyTarget = {
      name: "system-arch",
      candidatePath: "/repo/.archify/system-arch/candidate.json",
      outputPath: "/repo/.archify/system-arch/out.html",
      diagramType: "architecture",
      quality: "showcase",
    };

    const cmd = buildArchifyCommand({
      bin: "archify",
      action: "deliver",
      target,
    });

    expect(cmd).toBe(
      'archify deliver architecture "/repo/.archify/system-arch/candidate.json" "/repo/.archify/system-arch/out.html" --quality showcase --json',
    );
  });

  test("buildArchifyCommand builds render command when action is render", () => {
    const target: ArchifyTarget = {
      name: "flow",
      candidatePath: "/repo/.archify/flow/candidate.json",
      outputPath: "/repo/.archify/flow/out.html",
      diagramType: "workflow",
      quality: "standard",
    };

    const cmd = buildArchifyCommand({
      bin: "/usr/local/bin/archify",
      action: "render",
      target,
    });

    expect(cmd).toBe(
      '/usr/local/bin/archify render workflow "/repo/.archify/flow/candidate.json" "/repo/.archify/flow/out.html" --quality standard',
    );
  });
});

describe("syncDiagrams", () => {
  test("executes both Graphify update and Archify rendering on success", async () => {
    const executed: Array<{ cmd: string; cwd: string; timeout: number }> = [];

    const mockRunner = async (
      cmd: string,
      cwd: string,
      timeoutMs: number,
    ): Promise<CommandRunnerResult> => {
      executed.push({ cmd, cwd, timeout: timeoutMs });
      return { code: 0, stdout: "done", stderr: "", output: "done" };
    };

    const result = await syncDiagrams({
      cwd: process.cwd(),
      runner: mockRunner,
      archifyBin: "archify",
    });

    expect(result.success).toBe(true);
    expect(result.graphify).toBeDefined();
    expect(result.graphify?.command).toBe(CONSTANTS.GRAPHIFY_COMMAND);
    expect(result.graphify?.exitCode).toBe(0);

    expect(result.archify.length).toBeGreaterThanOrEqual(1);
    expect(result.archify[0]?.tool).toBe("archify");
    expect(result.archify[0]?.success).toBe(true);
    expect(executed.some((e) => e.cmd === CONSTANTS.GRAPHIFY_COMMAND)).toBe(true);
    expect(executed.some((e) => e.cmd.includes("deliver architecture"))).toBe(true);
  });

  test("captures Graphify failure cleanly without throwing", async () => {
    const mockRunner = async (cmd: string): Promise<CommandRunnerResult> => {
      if (cmd === CONSTANTS.GRAPHIFY_COMMAND) {
        return {
          code: 1,
          stdout: "",
          stderr: "graphify error: syntax failure",
          output: "graphify error: syntax failure",
        };
      }
      return { code: 0, stdout: "ok", stderr: "", output: "ok" };
    };

    const result = await syncDiagrams({
      cwd: process.cwd(),
      runner: mockRunner,
      archifyBin: "archify",
    });

    expect(result.success).toBe(false);
    expect(result.graphify?.success).toBe(false);
    expect(result.graphify?.exitCode).toBe(1);
    expect(result.graphify?.stderr).toContain("graphify error: syntax failure");
  });

  test("captures Archify failure cleanly and continues recording all targets", async () => {
    const mockRunner = async (cmd: string): Promise<CommandRunnerResult> => {
      if (cmd.includes("archify deliver")) {
        return {
          code: 2,
          stdout: "",
          stderr: "archify validation error",
          output: "archify validation error",
        };
      }
      return { code: 0, stdout: "ok", stderr: "", output: "ok" };
    };

    const result = await syncDiagrams({
      cwd: process.cwd(),
      runner: mockRunner,
      archifyBin: "archify",
    });

    expect(result.success).toBe(false);
    expect(result.graphify?.success).toBe(true);
    expect(result.archify.length).toBeGreaterThanOrEqual(1);
    expect(result.archify[0]?.success).toBe(false);
    expect(result.archify[0]?.exitCode).toBe(2);
    expect(result.archify[0]?.stderr).toBe("archify validation error");
  });

  test("respects runGraphify: false and runArchify: false", async () => {
    const executed: string[] = [];
    const mockRunner = async (cmd: string): Promise<CommandRunnerResult> => {
      executed.push(cmd);
      return { code: 0, stdout: "ok", stderr: "", output: "ok" };
    };

    const result1 = await syncDiagrams({
      cwd: process.cwd(),
      runGraphify: false,
      runArchify: true,
      runner: mockRunner,
      archifyBin: "archify",
    });
    expect(result1.graphify).toBeUndefined();
    expect(executed.some((c) => c === CONSTANTS.GRAPHIFY_COMMAND)).toBe(false);

    executed.length = 0;
    const result2 = await syncDiagrams({
      cwd: process.cwd(),
      runGraphify: true,
      runArchify: false,
      runner: mockRunner,
    });
    expect(result2.graphify).toBeDefined();
    expect(result2.archify).toEqual([]);
    expect(executed.some((c) => c === CONSTANTS.GRAPHIFY_COMMAND)).toBe(true);
  });

  test("emits progress hooks (say and log) during synchronization", async () => {
    const messages: string[] = [];
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];

    const mockRunner = async (): Promise<CommandRunnerResult> => ({
      code: 0,
      stdout: "ok",
      stderr: "",
      output: "ok",
    });

    await syncDiagrams({
      cwd: process.cwd(),
      runner: mockRunner,
      archifyBin: "archify",
      hooks: {
        say: (msg) => messages.push(msg),
        log: (event, data) => events.push({ event, data }),
      },
    });

    expect(messages.some((m) => m.includes("updating Graphify knowledge graph"))).toBe(true);
    expect(messages.some((m) => m.includes("✅ Graphify update"))).toBe(true);
    expect(messages.some((m) => m.includes("rendering Archify diagram"))).toBe(true);
    expect(events.some((e) => e.data.tool === "graphify")).toBe(true);
    expect(events.some((e) => e.data.tool === "archify")).toBe(true);
  });

  test("throws when throwOnError is true and a command fails", async () => {
    const mockRunner = async (): Promise<CommandRunnerResult> => ({
      code: 1,
      stdout: "",
      stderr: "fail",
      output: "fail",
    });

    await expect(
      syncDiagrams({
        cwd: process.cwd(),
        throwOnError: true,
        runner: mockRunner,
      }),
    ).rejects.toThrow("Diagram synchronization failed");
  });
});
