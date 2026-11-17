import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../config";
import { parseTasks, taskChecks } from "../../src/facade/tasks";

const BOM = "﻿";
const LINES = ["## 1. Build", "- [ ] 1.1 Create the module", "  Verify: `bun test`", "- [x] 1.2 Done already"];
const EXPECTED_TASK_COUNT = 2;
const FIRST_TASK_LINE_INDEX = 1;

function summary(markdown: string): Array<{ id: string; done: boolean; line: number; verified: boolean }> {
  return parseTasks(markdown).map((task) => ({
    id: task.id,
    done: task.done,
    line: task.line,
    verified: task.text.includes("Verify:"),
  }));
}

describe("parseTasks: line endings and BOM", () => {
  const lf = summary(LINES.join("\n"));

  test("LF input yields the tasks and keeps the Verify text", () => {
    expect(lf).toHaveLength(EXPECTED_TASK_COUNT);
    expect(lf[0]).toEqual({ id: "1.1", done: false, line: FIRST_TASK_LINE_INDEX, verified: true });
  });

  test("CRLF input yields the same tasks as LF", () => {
    expect(summary(LINES.join("\r\n"))).toEqual(lf);
  });

  test("CR input yields the same tasks as LF", () => {
    expect(summary(LINES.join("\r"))).toEqual(lf);
  });

  test("a leading BOM does not hide the first line", () => {
    expect(summary(`${BOM}${LINES.join("\n")}`)).toEqual(lf);
  });

  test("a BOM before the first task line does not hide that task", () => {
    expect(summary(`${BOM}- [ ] 1.1 First\n  Verify: \`bun test\``)).toEqual([
      { id: "1.1", done: false, line: 0, verified: true },
    ]);
  });
});

describe("taskChecks", () => {
  const ARCH_CHECK = "bun run arch:check";

  function checksFor(lines: string[], alwaysVerify: string[]): string[] {
    const dir = mkdtempSync(join(tmpdir(), "task-checks-"));
    try {
      const config = loadConfig({
        argv: ["--repo", dir, "--changes", "demo"],
        env: {},
        cwd: dir,
        overrides: { alwaysVerify },
      });
      const [task] = parseTasks(lines.join("\n"));
      return taskChecks(task!, config);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("Duplicate command", () => {
    const lines = ["## 1. Build", "- [ ] 1.1 Create it", `  Verify: \`${ARCH_CHECK}\` passes`];
    expect(checksFor(lines, [ARCH_CHECK])).toEqual([ARCH_CHECK]);
  });

  test("Commands run as written", () => {
    const lines = ["## 1. Build", "- [ ] 1.1 Create it", "  Verify: `bun test` passes"];
    expect(checksFor(lines, ["bunx tsc --noEmit", "bun audit"])).toEqual(["bun test", "bunx tsc --noEmit", "bun audit"]);
  });

  test("Empty setting", () => {
    const lines = ["## 1. Build", "- [ ] 1.1 Create it", "  Verify: `bun test` passes"];
    expect(checksFor(lines, [])).toEqual(["bun test"]);
  });

  test("Task without Verify and without full verification", () => {
    expect(checksFor(["## 1. Build", "- [ ] 1.1 Create it"], [])).toEqual([]);
  });
});
