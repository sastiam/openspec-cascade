import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeChangeArtifacts } from "../../../src/sdd/analyze";
import { runNodeScript, runOpenSpecCli } from "../helpers/cli_runner";
import { E2E_CONSTANTS } from "../helpers/constants";
import { addOpenSpecChange, createTempGitRepo } from "../helpers/temp_repo";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      fn();
    }
  }
});

describe("Tier 4 Scenarios: Installer & SDD Hook Full Lifecycle Journey", () => {
  test(
    "SDD hook lifecycle: blocks edit -> scaffold strict change -> allows edit -> blocks after tasks complete",
    async () => {
      const fixture = await createTempGitRepo();
      cleanups.push(fixture.cleanup);
      mkdirSync(join(fixture.repoDir, "openspec"), { recursive: true });

      const targetFile = join(fixture.repoDir, "src", "engine.ts");
      const hookPayload = JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: targetFile },
        cwd: fixture.repoDir,
      });

      const step1Blocked = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: hookPayload,
      });
      expect(step1Blocked.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);

      const changeDir = addOpenSpecChange(fixture.repoDir, "lifecycle-change", {
        includeConstitution: true,
        capabilitySlug: "engine-flow",
      });

      const strictCheck = await runOpenSpecCli(fixture.repoDir, [
        "validate",
        "lifecycle-change",
        "--strict",
      ]);
      expect(strictCheck.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

      const analyzeCheck = await analyzeChangeArtifacts("lifecycle-change", fixture.repoDir);
      expect(analyzeCheck.passed).toBe(true);

      const step2Allowed = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: hookPayload,
      });
      expect(step2Allowed.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

      writeFileSync(
        join(changeDir, "tasks.md"),
        "## 1. Implementation\n\n- [x] 1.1 Completed engine-flow\n",
        "utf8",
      );

      const step3BlockedAgain = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
        cwd: fixture.repoDir,
        homeDir: fixture.homeDir,
        stdin: hookPayload,
      });
      expect(step3BlockedAgain.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test(
    "bin/install.mjs --yes provisions isolated CLAUDE_CONFIG_DIR fallback settings and workflow",
    async () => {
      const fixture = await createTempGitRepo();
      cleanups.push(fixture.cleanup);

      const claudeConfigDir = join(fixture.homeDir, "isolated-claude");
      const result = await runNodeScript(E2E_CONSTANTS.INSTALLER_SCRIPT, ["--yes"], {
        cwd: E2E_CONSTANTS.REPO_ROOT,
        homeDir: fixture.homeDir,
        env: {
          CLAUDE_CONFIG_DIR: claudeConfigDir,
          PATH: "/nonexistent",
        },
      });

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);

      const settingsPath = join(claudeConfigDir, "settings.json");
      const workflowPath = join(claudeConfigDir, "workflows", "cascade-looper.mjs");
      expect(existsSync(settingsPath)).toBe(true);
      expect(existsSync(workflowPath)).toBe(true);

      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        enableWorkflows?: boolean;
        enabledPlugins?: Record<string, boolean>;
        extraKnownMarketplaces?: Record<string, unknown>;
      };
      expect(settings.enableWorkflows).toBe(true);
      expect(settings.enabledPlugins?.["cascade@openspec-cascade"]).toBe(true);
      expect(settings.extraKnownMarketplaces?.["openspec-cascade"]).toBeDefined();
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );
});
