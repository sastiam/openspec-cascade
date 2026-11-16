import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSubcommand, type CliOutput } from "../../src/cli/commands";
import { runLintTasks } from "../../src/cli/lint_tasks";
import { EXIT_CODE_CONSTANTS } from "../../src/config/constants";

const OK = EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
const FINDINGS = EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
const USAGE = EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
const USAGE_PREFIX = "USAGE: cascade lint-tasks:";
const OLD_STYLE_TASK_COUNT = 2;

const CLEAN = ["# Tasks", "- [ ] 1.1 Do it", "  Verify: `bun test`", ""].join("\n");
const NO_VERIFY = ["# Tasks", "- [ ] 1.1 Do it", ""].join("\n");
const WITH_FENCE = ["# Tasks", "- [x] 1.1 Done", "```", "code", "```", ""].join("\n");
const OLD_STYLE = ["# Tasks", "- [ ] 1.1 Build it; verify with the unit tests", "- [ ] 1.2 Wire it; verify with the e2e run", ""].join("\n");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

function capture(): CliOutput & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, info: (message) => out.push(message), error: (message) => err.push(message) };
}

/**
 * Builds a repository with one folder per change; an `undefined` content leaves the change without a tasks.md.
 */
function makeRepo(changes: Record<string, string | undefined>): string {
  const repo = mkdtempSync(join(tmpdir(), "lint-tasks-"));
  dirs.push(repo);
  for (const [change, tasks] of Object.entries(changes)) {
    const dir = join(repo, "openspec", "changes", change);
    mkdirSync(dir, { recursive: true });
    if (tasks !== undefined) writeFileSync(join(dir, "tasks.md"), tasks);
  }
  return repo;
}

function lint(argv: string[], output = capture()): { code: number; output: ReturnType<typeof capture> } {
  return { code: runLintTasks(argv, output), output };
}

describe("lint-tasks", () => {
  test("is registered as a subcommand", () => {
    expect(detectSubcommand(["lint-tasks", "--changes", "a"])).toBe("lint-tasks");
  });

  test("exits 0 and prints the ok line for clean changes passed as a comma list", () => {
    const repo = makeRepo({ a: CLEAN, b: CLEAN });
    const { code, output } = lint(["--repo", repo, "--changes", "a,b"]);
    expect(code).toBe(OK);
    expect(output.out).toEqual(["lint-tasks: ok (a,b)"]);
    expect(output.err).toEqual([]);
  });

  test("repeated --changes flags lint the same changes", () => {
    const repo = makeRepo({ a: CLEAN, b: CLEAN });
    const { code, output } = lint(["--repo", repo, "--changes", "a", "--changes", "b"]);
    expect(code).toBe(OK);
    expect(output.out).toEqual(["lint-tasks: ok (a,b)"]);
  });

  test("exits 1 and reports the findings of every change on stderr", () => {
    const repo = makeRepo({ a: NO_VERIFY, b: WITH_FENCE, c: CLEAN });
    const { code, output } = lint(["--repo", repo, "--changes", "a,b,c"]);
    expect(code).toBe(FINDINGS);
    expect(output.err).toHaveLength(2);
    expect(output.err[0]).toStartWith("a: tasks.md:2: missing-verify ");
    expect(output.err[1]).toStartWith("b: tasks.md:3: no-code-block ");
    expect(output.out).toEqual([]);
  });

  test("an old-style tasks.md fails with one finding per unchecked task", () => {
    const repo = makeRepo({ legacy: OLD_STYLE });
    const { code, output } = lint(["--repo", repo, "--changes", "legacy"]);
    expect(code).toBe(FINDINGS);
    expect(output.err).toHaveLength(OLD_STYLE_TASK_COUNT);
  });

  test("exits 2 when --changes is missing", () => {
    const { code, output } = lint(["--repo", makeRepo({})]);
    expect(code).toBe(USAGE);
    expect(output.err[0]).toStartWith(USAGE_PREFIX);
  });

  test("exits 2 for an invalid change name", () => {
    const { code, output } = lint(["--repo", makeRepo({}), "--changes", "../escape"]);
    expect(code).toBe(USAGE);
    expect(output.err[0]).toStartWith(USAGE_PREFIX);
  });

  test("exits 2 for an unknown flag", () => {
    const { code, output } = lint(["--repo", makeRepo({ a: CLEAN }), "--changes", "a", "--nope"]);
    expect(code).toBe(USAGE);
    expect(output.err[0]).toStartWith(USAGE_PREFIX);
  });

  test("exits 2 when a listed change has no tasks.md", () => {
    const repo = makeRepo({ a: CLEAN, missing: undefined });
    const { code, output } = lint(["--repo", repo, "--changes", "a,missing"]);
    expect(code).toBe(USAGE);
    expect(output.err[0]).toStartWith(USAGE_PREFIX);
    expect(output.err[0]).toContain("missing");
  });
});
