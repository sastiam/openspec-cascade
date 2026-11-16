import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCommandRunner, type CommandRunner, type CommandRunnerResult } from "./qa";
import { detectAffectedFiles, parseNulList } from "./fast_track";

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
