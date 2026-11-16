import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCommandRunner, type CommandRunner, type CommandRunnerResult } from "./qa";
import { classifyCheck, detectAffectedFiles, isDocsOnly, parseNulList, selectChecks, selectVerifyChecks } from "./fast_track";

const OK = (stdout: string): CommandRunnerResult => ({ code: 0, stdout, stderr: "", output: stdout });
const FAIL: CommandRunnerResult = { code: 1, stdout: "", stderr: "boom", output: "boom" };

describe("parseNulList", () => {
  test("splits NUL separated paths and keeps spaces", () => {
    expect(parseNulList("a.md\0b c.md\0")).toEqual(["a.md", "b c.md"]);
  });

  test("returns an empty list for empty output", () => {
    expect(parseNulList("")).toEqual([]);
  });
});

describe("detectAffectedFiles (fake runner)", () => {
  const fake =
    (diff: CommandRunnerResult, untracked: CommandRunnerResult): CommandRunner =>
    async (command) =>
      command.startsWith("git diff") ? diff : untracked;

  test("returns the union of tracked changes and untracked files", async () => {
    const files = await detectAffectedFiles("/x", fake(OK("a.md\0b.ts\0"), OK("c.md\0")));
    expect(files).toEqual(["a.md", "b.ts", "c.md"]);
  });

  test("returns undefined when git diff fails", async () => {
    expect(await detectAffectedFiles("/x", fake(FAIL, OK("")))).toBeUndefined();
  });

  test("returns undefined when git ls-files fails", async () => {
    expect(await detectAffectedFiles("/x", fake(OK(""), FAIL))).toBeUndefined();
  });

  test("returns undefined when the runner throws", async () => {
    const throwing: CommandRunner = async () => {
      throw new Error("spawn failed");
    };
    expect(await detectAffectedFiles("/x", throwing)).toBeUndefined();
  });
});

describe("detectAffectedFiles (real git repo)", () => {
  test("sees unstaged edits, untracked files in new dirs, renames and paths with spaces", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fast-track-"));
    try {
      const sh = async (cmd: string) => {
        const res = await defaultCommandRunner(cmd, dir);
        expect(res.code).toBe(0);
      };
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "docs"));
      writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(dir, "docs", "guide.md"), "# guide\n");
      await sh("git init -q");
      await sh("git add -A");
      await sh("git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m init");

      writeFileSync(join(dir, "docs", "guide.md"), "# guide v2\n"); // unstaged modification (" M")
      mkdirSync(join(dir, "new dir"));
      writeFileSync(join(dir, "new dir", "x.md"), "x\n"); // untracked in a new directory
      await sh("git mv src/a.ts docs/a.md"); // staged rename ts -> md

      const files = await detectAffectedFiles(dir);
      expect(files).toBeDefined();
      expect([...files!].sort()).toEqual(["docs/a.md", "docs/guide.md", "new dir/x.md", "src/a.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined outside a git repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fast-track-nogit-"));
    try {
      expect(await detectAffectedFiles(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isDocsOnly", () => {
  test("accepts documentation files, including spaces and upper-case extensions", () => {
    expect(isDocsOnly(["README.md", "docs/a.MDX", "LICENSE", "docs/my notes.md", "README.MD"])).toBe(true);
  });

  test("rejects empty and undefined lists", () => {
    expect(isDocsOnly([])).toBe(false);
    expect(isDocsOnly(undefined)).toBe(false);
  });

  test("rejects a mix of docs and code", () => {
    expect(isDocsOnly(["a.md", "src/a.ts"])).toBe(false);
  });

  test("rejects manifests, lockfiles, images and code under docs/", () => {
    expect(isDocsOnly(["package.json"])).toBe(false);
    expect(isDocsOnly(["bun.lock"])).toBe(false);
    expect(isDocsOnly(["docs/img.png"])).toBe(false);
    expect(isDocsOnly(["docs/x/y.ts"])).toBe(false);
  });
});

describe("classifyCheck", () => {
  test("typecheck", () => {
    expect(classifyCheck("bunx tsc --noEmit")).toBe("typecheck");
    expect(classifyCheck("bun run typecheck")).toBe("typecheck");
  });

  test("test", () => {
    expect(classifyCheck("bun test")).toBe("test");
    expect(classifyCheck("bun run test:e2e")).toBe("test");
    expect(classifyCheck("npx vitest run")).toBe("test");
  });

  test("lint and build", () => {
    expect(classifyCheck("bun run lint")).toBe("lint");
    expect(classifyCheck("eslint .")).toBe("lint");
    expect(classifyCheck("bun run build")).toBe("build");
  });

  test("substrings do not count as keywords", () => {
    expect(classifyCheck("bun run latest")).toBe("other");
    expect(classifyCheck("bun run attest")).toBe("other");
    expect(classifyCheck("bun run db:generate")).toBe("other");
    expect(classifyCheck("nuxt prepare")).toBe("other");
  });
});

describe("selectChecks", () => {
  const commands = ["bunx tsc --noEmit", "bun test", "bun run lint", "bun run build", "nuxt prepare"];

  test("docs-only skips typecheck, test and build but keeps lint and unknown commands", () => {
    expect(selectChecks(commands, ["docs/a.md"], { forceFull: false })).toEqual({
      run: ["bun run lint", "nuxt prepare"],
      skipped: ["bunx tsc --noEmit", "bun test", "bun run build"],
    });
  });

  test("forceFull never skips", () => {
    expect(selectChecks(commands, ["docs/a.md"], { forceFull: true })).toEqual({ run: commands, skipped: [] });
  });

  test("code changes or unknown files run everything", () => {
    expect(selectChecks(commands, ["docs/a.md", "src/a.ts"], { forceFull: false }).run).toEqual(commands);
    expect(selectChecks(commands, undefined, { forceFull: false }).run).toEqual(commands);
  });
});

describe("selectVerifyChecks", () => {
  const commands = ["bunx tsc --noEmit", "bun test", "bun run lint"];
  const docsRunner: CommandRunner = async (command) =>
    command.startsWith("git diff") ? OK("docs/a.md\0") : OK("");

  test("docs-only skips heavy checks, announces it once and logs the event", async () => {
    const said: string[] = [];
    const logged: Array<{ event: string; data: Record<string, unknown> }> = [];
    const run = await selectVerifyChecks(commands, {
      cwd: "/x",
      forceFull: false,
      runner: docsRunner,
      say: (message) => said.push(message),
      log: (event, data) => logged.push({ event, data }),
    });
    expect(run).toEqual(["bun run lint"]);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("fast-track");
    expect(said[0]).toContain("bun test");
    expect(logged).toEqual([
      { event: "fast_track", data: { skipped: ["bunx tsc --noEmit", "bun test"], files: ["docs/a.md"] } },
    ]);
  });

  test("stays silent when nothing is skipped", async () => {
    const said: string[] = [];
    const logged: unknown[] = [];
    const codeRunner: CommandRunner = async (command) =>
      command.startsWith("git diff") ? OK("src/a.ts\0") : OK("");
    const run = await selectVerifyChecks(commands, {
      cwd: "/x",
      forceFull: false,
      runner: codeRunner,
      say: (message) => said.push(message),
      log: (...args) => logged.push(args),
    });
    expect(run).toEqual(commands);
    expect(said).toEqual([]);
    expect(logged).toEqual([]);
  });

  test("ignores cascade's own workspace artifacts when deciding docs-only", async () => {
    const polluted: CommandRunner = async (command) =>
      command.startsWith("git diff") ? OK("docs/a.md\0") : OK(".cascade/telemetry/day.jsonl\0");
    const run = await selectVerifyChecks(commands, {
      cwd: "/x",
      forceFull: false,
      runner: polluted,
      ignorePrefixes: [".cascade/"],
    });
    expect(run).toEqual(["bun run lint"]);
  });

  test("a change made only of ignored artifacts is not docs-only and runs everything", async () => {
    const onlyIgnored: CommandRunner = async (command) =>
      command.startsWith("git diff") ? OK("") : OK(".cascade/telemetry/day.jsonl\0");
    const run = await selectVerifyChecks(commands, {
      cwd: "/x",
      forceFull: false,
      runner: onlyIgnored,
      ignorePrefixes: [".cascade/"],
    });
    expect(run).toEqual(commands);
  });

  test("forceFull and empty command lists never touch git", async () => {
    let calls = 0;
    const counting: CommandRunner = async () => {
      calls++;
      return OK("");
    };
    expect(await selectVerifyChecks(commands, { cwd: "/x", forceFull: true, runner: counting })).toEqual(commands);
    expect(await selectVerifyChecks([], { cwd: "/x", forceFull: false, runner: counting })).toEqual([]);
    expect(calls).toBe(0);
  });

  test("a runner that throws runs every command", async () => {
    const throwing: CommandRunner = async () => {
      throw new Error("spawn failed");
    };
    expect(await selectVerifyChecks(commands, { cwd: "/x", forceFull: false, runner: throwing })).toEqual(commands);
  });
});
