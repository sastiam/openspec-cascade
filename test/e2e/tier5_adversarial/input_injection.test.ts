import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../../config";
import { BudgetExceededError, enforceSessionBudget } from "../../../src/config/guardrails";
import { ConfigValidationError } from "../../../src/config/schemas";
import { isSafeVerifyCommand, runChecks, verifyCommands } from "../../../src/facade/tasks";
import { runCascadeCli } from "../helpers/cli_runner";
import { E2E_CONSTANTS } from "../helpers/constants";
import { createTempGitRepo, type TempGitRepo } from "../helpers/temp_repo";

const repos: TempGitRepo[] = [];
afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
});

describe("Tier 5: input injection", () => {
  test.each([["../../etc"], ["a/b"], [".hidden"], ["a..b"], ["c1,../escape"], ["x;rm"], ["a\\b"]])(
    "change id %p is rejected at the configuration boundary",
    (changes) => {
      expect(() => loadConfig({ argv: ["--changes", changes], env: {} })).toThrow(ConfigValidationError);
    },
  );

  test(
    "the real CLI fails closed on traversal before touching files outside the repository",
    async () => {
      const fixture = await createTempGitRepo({ branch: "feat/t5-traversal" });
      repos.push(fixture);
      const outside = join(fixture.homeDir, "outside");
      mkdirSync(join(outside, "openspec", "changes", "victim"), { recursive: true });
      writeFileSync(join(outside, "openspec", "changes", "victim", "tasks.md"), "## 1. X\n- [ ] 1.1 should never be read\n");
      const result = await runCascadeCli({
        args: ["--repo", fixture.repoDir, "--changes", "../../outside/openspec/changes/victim", "--dry-run", "--no-keep-alive"],
        homeDir: fixture.homeDir,
      });
      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
      expect(result.stderr).toContain("change id");
      expect(result.stdout).not.toContain("should never be read");
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test("chained, piped, redirected or substituted verify commands never reach the shell", async () => {
    const fixture = await createTempGitRepo({ branch: "feat/t5-verify" });
    repos.push(fixture);
    const marker = join(fixture.homeDir, "pwned");
    const payloads = [
      `bun --version; touch ${marker}`,
      `bun --version && touch ${marker}`,
      `bun --version | tee ${marker}`,
      `bun --version > ${marker}`,
      `bun run $(touch ${marker})`,
    ];
    for (const payload of payloads) expect(isSafeVerifyCommand(payload)).toBe(false);
    const task = { id: "1.1", done: false, section: "s", line: 0, text: payloads.map((payload) => `Verify: \`${payload}\``).join(" ") };
    const commands = verifyCommands(task, false, { repoRoot: fixture.repoDir });
    expect(commands.some((command) => command.includes(marker))).toBe(false);
    await runChecks(commands, fixture.repoDir, E2E_CONSTANTS.DEFAULT_SUBPROCESS_TIMEOUT_MS);
    expect(existsSync(marker)).toBe(false);
    expect(isSafeVerifyCommand("bun test test/unit")).toBe(true);
  });

  test.each([["NaN"], ["Infinity"], ["1e309"], ["-1"], ["0x10"], [""], ["5 USD"]])(
    "budget injection %p fails closed through the real CLI",
    async (budget) => {
      const result = await runCascadeCli({ args: ["--budget", budget, "--changes", "x", "--dry-run", "--no-keep-alive"] });
      expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
    },
    E2E_CONSTANTS.SLOW_TEST_TIMEOUT_MS,
  );

  test("environment budget overflow fails closed and the session guard rejects non-finite spend", async () => {
    const result = await runCascadeCli({
      args: ["--changes", "x", "--dry-run", "--no-keep-alive"],
      env: { CASCADE_MAX_BUDGET_USD: "Infinity" },
    });
    expect(result.exitCode).toBe(E2E_CONSTANTS.EXIT_CODE_FATAL);
    for (const spent of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE, -1]) {
      expect(() => enforceSessionBudget(spent, 10)).toThrow(BudgetExceededError);
    }
    expect(() => enforceSessionBudget(10, 10)).toThrow(BudgetExceededError);
    expect(() => enforceSessionBudget(9.99, 10)).not.toThrow();
  });
});
