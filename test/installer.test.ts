import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("Claude Code Plugin & Marketplace Manifests", () => {
  test("marketplace.json is valid and registers cascade plugin", () => {
    const marketplacePath = join(process.cwd(), ".claude-plugin", "marketplace.json");
    expect(existsSync(marketplacePath)).toBe(true);

    const content = JSON.parse(readFileSync(marketplacePath, "utf-8"));
    expect(content.name).toBe("openspec-cascade");
    expect(content.plugins).toBeArray();
    expect(content.plugins.some((p: { name: string }) => p.name === "cascade")).toBe(true);
  });

  test("plugin.json is valid and specifies version 2.0.0", () => {
    const pluginPath = join(
      process.cwd(),
      "plugins",
      "cascade",
      ".claude-plugin",
      "plugin.json"
    );
    expect(existsSync(pluginPath)).toBe(true);

    const content = JSON.parse(readFileSync(pluginPath, "utf-8"));
    expect(content.name).toBe("cascade");
    expect(content.version).toBe("2.0.0");
    expect(content.author.name).toBe("sastiam");
  });

  test("workflow and command definitions exist", () => {
    const workflowPath = join(
      process.cwd(),
      "plugins",
      "cascade",
      "workflows",
      "cascade-looper.mjs"
    );
    expect(existsSync(workflowPath)).toBe(true);

    const cmdPath = join(
      process.cwd(),
      "plugins",
      "cascade",
      "commands",
      "cascade.md"
    );
    expect(existsSync(cmdPath)).toBe(true);

    const looperCmdPath = join(
      process.cwd(),
      "plugins",
      "cascade",
      "commands",
      "cascade-looper.md"
    );
    expect(existsSync(looperCmdPath)).toBe(true);
  });

  test("hooks.json maps PreToolUse to sdd_gate.mjs", () => {
    const hooksPath = join(process.cwd(), "plugins", "cascade", "hooks", "hooks.json");
    expect(existsSync(hooksPath)).toBe(true);

    const content = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(content.hooks.PreToolUse).toBeArray();
    expect(content.hooks.PreToolUse[0].matcher).toContain("Edit");
  });
});

describe("CLI Installer Execution", () => {
  test("executes bin/install.mjs in --dry-run mode cleanly with exit code 0", async () => {
    const proc = Bun.spawn(["node", "bin/install.mjs", "--dry-run", "--yes"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    expect(code).toBe(0);
    expect(out).toContain("OpenSpec Cascade v2 — Claude Code CLI Installer");
    expect(out).toContain("DRY-RUN complete");
    expect(out).toContain("cascade-looper.mjs");
  });
});
