import { describe, expect, test } from "bun:test";
import { parseTasks } from "../../src/facade/tasks";
import { formatFinding, lintTasks, normalizeLines } from "../../src/sdd/tasks_lint";

const MIN_FENCE_LENGTH = 3; // shortest run of backticks or tildes that opens a fence
const LONG_FENCE_LENGTH = MIN_FENCE_LENGTH + 1;
const TICKS = "`".repeat(MIN_FENCE_LENGTH);
const FOUR_TICKS = "`".repeat(LONG_FENCE_LENGTH);
const TILDES = "~".repeat(MIN_FENCE_LENGTH);
const NO_CODE = "no-code-block";
const NO_VERIFY = "missing-verify";
const BOM = "﻿";
const LINE_NUMBER_BASE = 1; // lint lines are 1-based, parseTasks lines are 0-based
const VERIFY = "  Verify: `bun test`";

function doc(...lines: string[]): string {
  return lines.join("\n");
}

function found(markdown: string): Array<{ line: number; rule: string }> {
  return lintTasks(markdown).map((finding) => ({ line: finding.line, rule: finding.rule }));
}

describe("lintTasks: clean files", () => {
  test("two unchecked tasks with an indented Verify give no findings", () => {
    expect(found(doc("# Tasks", "", "- [ ] 1.1 Do it", VERIFY, "- [ ] 1.2 Do more", VERIFY))).toEqual([]);
  });

  test("empty file gives no findings", () => {
    expect(found("")).toEqual([]);
  });

  test("checked tasks are not linted, in lowercase and uppercase", () => {
    expect(found(doc("- [x] 1.1 Done", "- [X] 1.2 Done"))).toEqual([]);
  });

  test("last task at the end of the file without a trailing newline", () => {
    expect(found(doc("- [ ] 1.1 Do it", VERIFY))).toEqual([]);
  });

  test("Verify with a dash marker, a star marker or a tab indent", () => {
    expect(found(doc("- [ ] 1.1 a", "  - Verify: `x`"))).toEqual([]);
    expect(found(doc("- [ ] 1.1 a", "  * Verify: `x`"))).toEqual([]);
    expect(found(doc("- [ ] 1.1 a", "\tVerify: `x`"))).toEqual([]);
  });

  test("a nested checkbox line belongs to the parent block", () => {
    expect(found(doc("- [ ] 1.1 a", VERIFY, "  - [ ] nested"))).toEqual([]);
  });
});

describe("lintTasks: no-code-block", () => {
  test("backtick fence reports its opening line", () => {
    expect(found(doc("# T", "", "- [x] 1.1 Done", "", TICKS, "code", TICKS))).toEqual([{ line: 5, rule: NO_CODE }]);
  });

  test("fence with an info string", () => {
    expect(found(doc("# T", "", "- [x] 1.1 Done", "", `${TICKS}ts`, "code", TICKS))).toEqual([{ line: 5, rule: NO_CODE }]);
  });

  test("tilde fence", () => {
    expect(found(doc("# T", TILDES, "code", TILDES))).toEqual([{ line: 2, rule: NO_CODE }]);
  });

  test("tilde fence whose body holds backtick fences is one finding", () => {
    expect(found(doc("# T", TILDES, TICKS, "x", TICKS, TILDES))).toEqual([{ line: 2, rule: NO_CODE }]);
  });

  test("a shorter fence line does not close a longer fence", () => {
    expect(found(doc("# T", FOUR_TICKS, TICKS, "x", TICKS, FOUR_TICKS))).toEqual([{ line: 2, rule: NO_CODE }]);
  });

  test("indented fence opener", () => {
    expect(found(doc("- [x] 1.1 d", `  ${TICKS}`, "  x", `  ${TICKS}`))).toEqual([{ line: 2, rule: NO_CODE }]);
  });

  test("unclosed fence is one finding and hides the tasks after it", () => {
    expect(found(doc("- [ ] 1.1 a", VERIFY, TICKS, "- [ ] 1.2 b"))).toEqual([{ line: 3, rule: NO_CODE }]);
  });

  test("three backticks, text and three backticks on one line is inline code", () => {
    expect(found(doc("- [x] 1.1 d", `${TICKS} text ${TICKS}`))).toEqual([]);
  });
});

describe("lintTasks: missing-verify", () => {
  test("unchecked task without Verify", () => {
    expect(found(doc("- [ ] 1.1 a"))).toEqual([{ line: 1, rule: NO_VERIFY }]);
  });

  test("unchecked task without an ID", () => {
    expect(found(doc("- [ ] do it"))).toEqual([{ line: 1, rule: NO_VERIFY }]);
  });

  test("Verify on the task line only", () => {
    expect(found(doc("- [ ] 1.1 a Verify: `bun test`"))).toEqual([{ line: 1, rule: NO_VERIFY }]);
  });

  test("lowercase and bold spellings do not count", () => {
    expect(found(doc("- [ ] 1.1 a", "  verify: `x`"))).toEqual([{ line: 1, rule: NO_VERIFY }]);
    expect(found(doc("- [ ] 1.1 a", "  **Verify:** `x`"))).toEqual([{ line: 1, rule: NO_VERIFY }]);
  });

  test("empty Verify does not count", () => {
    expect(found(doc("- [ ] 1.1 a", "  Verify:"))).toEqual([{ line: 1, rule: NO_VERIFY }]);
    expect(found(doc("- [ ] 1.1 a", "  Verify:   "))).toEqual([{ line: 1, rule: NO_VERIFY }]);
  });

  test("Verify after a blank line does not count", () => {
    expect(found(doc("- [ ] 1.1 a", "", VERIFY))).toEqual([{ line: 1, rule: NO_VERIFY }]);
  });

  test("a heading ends the block", () => {
    expect(found(doc("- [ ] 1.1 a", "## Next", VERIFY))).toEqual([{ line: 1, rule: NO_VERIFY }]);
  });

  test("Verify inside a fence gives both findings", () => {
    expect(found(doc("- [ ] 1.1 a", `  ${TICKS}`, VERIFY, `  ${TICKS}`))).toEqual([
      { line: 1, rule: NO_VERIFY },
      { line: 2, rule: NO_CODE },
    ]);
  });
});

describe("lintTasks: order, line endings and formatting", () => {
  test("findings come sorted by line", () => {
    const markdown = doc("# T", "", "- [ ] 1.1 a", "", "p", "p", "p", "p", TICKS, "x", TICKS);
    expect(found(markdown)).toEqual([
      { line: 3, rule: NO_VERIFY },
      { line: 9, rule: NO_CODE },
    ]);
  });

  test("LF, CRLF, CR and BOM give the same findings and lines", () => {
    const lines = ["- [ ] 1.1 a", "", TICKS, "x", TICKS];
    const expected = found(lines.join("\n"));
    expect(expected).toHaveLength(2);
    expect(found(lines.join("\r\n"))).toEqual(expected);
    expect(found(lines.join("\r"))).toEqual(expected);
    expect(found(`${BOM}${lines.join("\n")}`)).toEqual(expected);
  });

  test("formatFinding renders the CLI line", () => {
    expect(formatFinding("demo", { line: 3, rule: NO_VERIFY, message: "m" })).toBe("demo: tasks.md:3: missing-verify m");
  });
});

describe("lint and parseTasks agree", () => {
  // Task 1.1 verified, 1.2 without Verify, 1.3 with Verify after a blank line, 1.4 verified with a list marker, 1.5 already checked.
  const lines = [
    "## 1. Build",
    "- [ ] 1.1 First",
    VERIFY,
    "- [ ] 1.2 Second",
    "- [ ] 1.3 Third",
    "",
    VERIFY,
    "- [ ] 1.4 Fourth",
    "  - Verify: `bun test`",
    "- [x] 1.5 Fifth",
  ];
  const variants: Array<[string, string]> = [
    ["LF", lines.join("\n")],
    ["CRLF", lines.join("\r\n")],
    ["CR", lines.join("\r")],
    ["BOM", `${BOM}${lines.join("\n")}`],
  ];

  for (const [name, markdown] of variants) {
    test(`${name}: an unchecked task passes the lint exactly when the runner sees its Verify`, () => {
      const flagged = new Set(lintTasks(markdown).filter((finding) => finding.rule === NO_VERIFY).map((finding) => finding.line));
      const unchecked = parseTasks(markdown).filter((task) => !task.done);
      expect(unchecked.map((task) => task.id)).toEqual(["1.1", "1.2", "1.3", "1.4"]);
      for (const task of unchecked) {
        const lintAccepts = !flagged.has(task.line + LINE_NUMBER_BASE);
        expect(lintAccepts).toBe(task.text.includes("Verify:"));
      }
    });
  }
});

describe("normalizeLines", () => {
  test("strips a BOM and splits on LF, CRLF and CR", () => {
    expect(normalizeLines(`${BOM}a\nb`)).toEqual(["a", "b"]);
    expect(normalizeLines("a\r\nb")).toEqual(["a", "b"]);
    expect(normalizeLines("a\rb")).toEqual(["a", "b"]);
  });
});
