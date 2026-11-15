import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../config";
import { SELF_IMPROVER_CONSTANTS } from "../../src/config/constants";
import { categorizeFailure, failureSignature, normalizeFailureTrace, SelfImprover } from "../../src/core/self_improver";
import type { EngineOutcome, EngineSessionOptions } from "../../src/engine/contract";
import { CascadeFacade } from "../../src/facade";
import type { UnifiedEngine } from "../../src/pal/factory";
import type { IPalProvider } from "../../src/pal/types";
import { addOpenSpecChange, createTempGitRepo, runGitCommand, type TempGitRepo } from "../e2e/helpers/temp_repo";

const dirs: string[] = [];
const repos: TempGitRepo[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
  while (repos.length > 0) repos.pop()?.cleanup();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cascade-self-improver-"));
  dirs.push(dir);
  return dir;
}

describe("failure signatures", () => {
  test("normalize volatile tokens so recurrences collide", () => {
    const first = "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    const second = "src/app.ts(48,9): error TS2322: Type 'boolean' is not assignable to type 'number'.";
    expect(normalizeFailureTrace(first)).toBe(normalizeFailureTrace(second));
    expect(failureSignature(first)).toBe(failureSignature(second));
    expect(failureSignature(first)).not.toBe(failureSignature("eslint: no-magic-numbers"));
  });

  test("categorize failures", () => {
    expect(categorizeFailure("error TS2304: Cannot find name 'x'")).toBe("type_error");
    expect(categorizeFailure("(fail) greet > says hello")).toBe("test_failure");
    expect(categorizeFailure("eslint found no-explicit-any")).toBe("lint");
    expect(categorizeFailure("command timed out")).toBe("timeout");
    expect(categorizeFailure("429 Too Many Requests")).toBe("rate_limit");
    expect(categorizeFailure("401 unauthorized")).toBe("auth");
    expect(categorizeFailure("segfault")).toBe("unknown");
  });
});

describe("SelfImprover", () => {
  test("persists redacted JSONL per day and skips malformed lines", () => {
    const root = tempDir();
    const improver = new SelfImprover({ rootDir: root, now: () => Date.parse("2026-11-15T10:00:00Z") });
    improver.recordOutcome({ source: "session", outcome: "error", failureTrace: "auth failed api_key=sk-live-abcdefghijklmnopqrstuvwxyz0123456789" });
    const file = join(root, ".cascade", "telemetry", "2026-11-15.jsonl");
    const content = readFileSync(file, "utf8");
    expect(content).not.toContain("sk-live-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(content).toContain("[REDACTED]");
    writeFileSync(file, `${content}{not json\n{"partial":true}\n\n`);
    expect(improver.loadHistory()).toHaveLength(1);
    expect(new SelfImprover({ rootDir: tempDir() }).loadHistory()).toEqual([]);
  });

  test("derives bounded, deterministic directives from recurring signatures", () => {
    const improver = new SelfImprover({ rootDir: tempDir() });
    const history = [
      ...[12, 30, 44].map((line) => ({ timestamp: "t", source: "gate" as const, outcome: "x", failureTrace: `src/a.ts(${line},1): error TS2322: Type 'x' is not assignable` })),
      { timestamp: "t", source: "gate" as const, outcome: "x", failureTrace: "one-off crash" },
      { timestamp: "t", source: "session" as const, outcome: "done" },
    ];
    const directives = improver.deriveDirectives(history);
    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({ occurrences: 3 });
    expect(directives[0]?.id).toStartWith(SELF_IMPROVER_CONSTANTS.DIRECTIVE_ID_PREFIX);
    expect(directives[0]?.directive).toContain("Recurring type_error");
    expect(improver.deriveDirectives(history)).toEqual(directives);
    const many = Array.from({ length: 10 }, (_, kind) =>
      Array.from({ length: 2 }, () => ({ timestamp: "t", source: "gate" as const, outcome: "x", failureTrace: `failure kind ${"abcdefghij"[kind]}` })),
    ).flat();
    expect(improver.deriveDirectives(many)).toHaveLength(SELF_IMPROVER_CONSTANTS.MAX_DIRECTIVES);
  });

  test("facade records failures, excludes telemetry from commits and injects directives into later prompts", async () => {
    const repo = await createTempGitRepo({ branch: "feat/self-improve" });
    repos.push(repo);
    addOpenSpecChange(repo.repoDir, "si", { tasksMarkdown: "## 1. Build\n- [ ] 1.1 Build it. Verify: `bun run definitely-missing-script`\n" });
    await runGitCommand(repo.repoDir, ["add", "-A"]);
    await runGitCommand(repo.repoDir, ["commit", "-m", "chore: fixture"]);
    const prompts: string[] = [];
    const engine: UnifiedEngine = {
      name: "opencode",
      engineType: "opencode",
      runSession: async (options: EngineSessionOptions): Promise<EngineOutcome> => {
        prompts.push(options.prompt);
        return { kind: "done", sessionId: "s", result: "ok", costUsd: 0 };
      },
      getDefaultModel: () => "m",
      supportsPlanMeters: () => false,
      getProvider: (): IPalProvider => {
        throw new Error("unused");
      },
    };
    const config = loadConfig({
      argv: ["--repo", repo.repoDir, "--changes", "si", "--log-dir", repo.logDir, "--engine", "opencode"],
      env: {},
      cwd: repo.repoDir,
      overrides: { keepAlive: false, autoDiagrams: false, maxAttemptsPerTask: 2 },
    });
    const quiet = { info: () => undefined, error: () => undefined };
    const first = await new CascadeFacade({ engine, output: quiet, resilience: false }).run(config);
    expect(first.exitCode).toBe(2);
    const telemetryDir = join(repo.repoDir, ".cascade", "telemetry");
    expect(existsSync(telemetryDir)).toBe(true);
    expect(readdirSync(telemetryDir).length).toBe(1);
    prompts.length = 0;
    const second = await new CascadeFacade({ engine, output: quiet, resilience: false }).run(config);
    expect(second.exitCode).toBe(2);
    expect(prompts[0]).toContain("Lessons from previous failures");
    expect(existsSync(telemetryDir)).toBe(true);
    expect((await runGitCommand(repo.repoDir, ["log", "--all", "--name-only", "--pretty="])).stdout).not.toContain(".cascade");
  }, 60_000);
});
