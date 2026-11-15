import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  commitTypeOf,
  commitsPerSection,
  isLastOfSection,
  parseTasks,
  taskPrompt,
  verifyCommands,
} from "../../../cascade";
import {
  discoverDirectives,
  discoverSkills,
  formatDirectivesPrompt,
  formatSkillsPrompt,
} from "../../../skills";
import { analyzeChangeArtifacts } from "../../../src/sdd/analyze";
import { evaluateSddGate } from "../../../src/sdd/sdd_gate";
import { classifySurfaces } from "../../../src/sdd/surface_verifier";
import { HarnessInjector } from "../../../src/core/harness_injector";
import { runCascadeCli, runNodeScript, runOpenSpecCli } from "../helpers/cli_runner";
import { E2E_CONSTANTS } from "../helpers/constants";
import { addOpenSpecChange, createTempGitRepo, runGitCommand } from "../helpers/temp_repo";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      fn();
    }
  }
});

describe("Tier 1 Features: F14–F16 Harness Prompting, SDD Gates, Skills & Plugin Hooks", () => {
  test("taskPrompt injects skills and directives from isolated temp repository", async () => {
    const fixture = await createTempGitRepo({
      skills: [
        {
          name: "e2e-skill",
          description: "Validates isolated E2E behavior.",
          location: "agents",
        },
      ],
      directives: [
        {
          filename: "AGENTS.md",
          content: "Always maintain strict typing and zero magic numbers.",
        },
      ],
    });
    cleanups.push(fixture.cleanup);

    const skills = discoverSkills(fixture.repoDir);
    const directives = discoverDirectives(fixture.repoDir);
    expect(skills.length).toBe(1);
    expect(directives.length).toBe(1);
    expect(formatSkillsPrompt(skills)).toContain("e2e-skill");
    expect(formatDirectivesPrompt(directives)).toContain("strict typing");

    const tasks = parseTasks(
      "## 1. Core\n\n- [ ] 1.1 Implement handler\n- [ ] 1.2 Verify: `bun test`. Commit `feat(core)`\n",
    );
    expect(tasks.length).toBe(2);
    expect(commitsPerSection(tasks)).toBe(false);
    expect(commitTypeOf(tasks[1]!)).toBe("feat(core)");
    expect(isLastOfSection(tasks, tasks[1]!)).toBe(true);

    const cmds = verifyCommands(tasks[1]!);
    expect(cmds).toContain("bun test");

    const prompt = taskPrompt("sample-change", tasks[0]!, cmds, false, fixture.repoDir);
    expect(prompt).toContain("<skills>");
    expect(prompt).toContain("e2e-skill");
    expect(prompt).toContain("<project-directives>");
    expect(prompt).toContain("Always maintain strict typing");
  });

  test("analyzeChangeArtifacts and openspec validate --strict both pass on scaffolded change", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    addOpenSpecChange(fixture.repoDir, "strict-e2e-change", {
      includeConstitution: true,
      capabilitySlug: "runner-core",
    });

    const analysis = await analyzeChangeArtifacts("strict-e2e-change", fixture.repoDir);
    expect(analysis.passed).toBe(true);
    expect(analysis.confirmedBlocking).toBe(0);

    const openspecResult = await runOpenSpecCli(fixture.repoDir, [
      "validate",
      "strict-e2e-change",
      "--strict",
    ]);
    expect(openspecResult.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
  }, E2E_CONSTANTS.TEST_TIMEOUT_MS);

  test("classifySurfaces separates frontend, backend, and core paths with targeted checks", () => {
    const report = classifySurfaces([
      "src/components/Dashboard.vue",
      "src/api/users.ts",
      "src/core/dag.ts",
    ]);

    expect(report.surfaces.frontend).toBe(true);
    expect(report.surfaces.backend).toBe(true);
    expect(report.surfaces.core).toBe(true);
    expect(report.recommendedChecks).toContain("sdd-verify:frontend-render-check");
    expect(report.recommendedChecks).toContain("sdd-verify:api-contract-smoke");
  });

  test("evaluateSddGate and sdd_gate.mjs allow production edits when active OpenSpec change exists", async () => {
    const fixture = await createTempGitRepo();
    cleanups.push(fixture.cleanup);

    addOpenSpecChange(fixture.repoDir, "active-change");

    const gateRes = await evaluateSddGate({
      toolName: "Edit",
      filePath: join(fixture.repoDir, "src", "module.ts"),
      repoRoot: fixture.repoDir,
    });
    expect(gateRes.allowed).toBe(true);
    expect(gateRes.activeChangeId).toBe("active-change");

    const hookRes = await runNodeScript(E2E_CONSTANTS.SDD_GATE_HOOK, [], {
      cwd: fixture.repoDir,
      homeDir: fixture.homeDir,
      stdin: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: join(fixture.repoDir, "src", "module.ts") },
        cwd: fixture.repoDir,
      }),
    });
    expect(hookRes.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
  }, E2E_CONSTANTS.TEST_TIMEOUT_MS);

  test(
    "bin/install.mjs --dry-run --yes runs cleanly with isolated CLAUDE_CONFIG_DIR",
    async () => {
      const fixture = await createTempGitRepo();
      cleanups.push(fixture.cleanup);

      const isolatedClaudeDir = join(fixture.homeDir, ".claude");
      const res = await runNodeScript(E2E_CONSTANTS.INSTALLER_SCRIPT, ["--dry-run", "--yes"], {
        cwd: E2E_CONSTANTS.REPO_ROOT,
        homeDir: fixture.homeDir,
        env: {
          CLAUDE_CONFIG_DIR: isolatedClaudeDir,
        },
      });

      expect(res.timedOut).toBe(false);
      expect(res.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(res.stdout).toContain("DRY-RUN complete. Nothing was changed.");
      expect(res.stdout).toContain(isolatedClaudeDir);
    },
    E2E_CONSTANTS.TEST_TIMEOUT_MS,
  );
  test(
    "cascade CLI --mode v2 --dry-run reports the analyze verdict and DAG order through the real pipeline",
    async () => {
      const fixture = await createTempGitRepo({ branch: "feat/e2e-v2" });
      cleanups.push(fixture.cleanup);
      addOpenSpecChange(fixture.repoDir, "v2-check", { includeConstitution: true });
      await runGitCommand(fixture.repoDir, ["add", "-A"]);
      await runGitCommand(fixture.repoDir, ["commit", "-m", "chore: fixture"]);
      const result = await runCascadeCli({
        args: ["--repo", fixture.repoDir, "--changes", "v2-check", "--mode", "v2", "--dry-run", "--no-keep-alive", "--engine", "opencode"],
        homeDir: fixture.homeDir,
      });
      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain("v2-check: 2 pending (v2 pipeline");
      expect(result.stdout).toContain("dag order: 1.1 -> 1.2");
      expect((await runGitCommand(fixture.repoDir, ["status", "--porcelain"])).stdout).toBe("");
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test(
    "cascade CLI --mode v2 fails closed when Analyze finds blocking gaps",
    async () => {
      const fixture = await createTempGitRepo({ branch: "feat/e2e-v2-blocked" });
      cleanups.push(fixture.cleanup);
      addOpenSpecChange(fixture.repoDir, "v2-blocked", { includeSpec: false, includeProposal: false });
      await runGitCommand(fixture.repoDir, ["add", "-A"]);
      await runGitCommand(fixture.repoDir, ["commit", "-m", "chore: fixture"]);
      const result = await runCascadeCli({
        args: ["--repo", fixture.repoDir, "--changes", "v2-blocked", "--mode", "v2", "--no-keep-alive", "--engine", "opencode"],
        homeDir: fixture.homeDir,
      });
      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(result.stderr).toContain("SDD analyze blocked");
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test("HarnessInjector assembles the real change artifacts and constitution", async () => {
    const fixture = await createTempGitRepo({ branch: "feat/e2e-harness" });
    cleanups.push(fixture.cleanup);
    addOpenSpecChange(fixture.repoDir, "harness-check", { includeConstitution: true });
    const harness = await new HarnessInjector().buildExecutionContext({
      repoRoot: fixture.repoDir,
      changeId: "harness-check",
      task: { id: "1.1", done: false, text: "Implement deterministic core-behavior execution behavior", section: "1. Implementation", line: 2 },
    });
    expect(harness.sections.map((section) => section.name)).toEqual(["task", "rules", "artifacts", "constitution"]);
    expect(harness.prompt).toContain("Requirement: Deterministic core-behavior execution");
  });

  test("plugin SDD hooks (.mjs and .cjs) block .rb production files without an active change", async () => {
    for (const hook of ["sdd_gate.mjs", "sdd_gate.cjs"]) {
      const result = await runNodeScript(join(E2E_CONSTANTS.REPO_ROOT, "plugins", "cascade", "hooks", hook), [], {
        stdin: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "lib/app.rb" }, cwd: E2E_CONSTANTS.REPO_ROOT + "/does-not-exist" }),
      });
      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(result.stderr).toContain("SDD Gate Block");
    }
  });
});
