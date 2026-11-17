import { describe, expect, test } from "bun:test";
import { parseTasks } from "../../src/facade/tasks";
import { formatFinding, lintManual, lintTasks, normalizeLines, parseManualSteps } from "../../src/sdd/tasks_lint";

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
        expect(task.verifyStart !== null).toBe(lintAccepts);
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

const MANUAL_STEP = "manual-step";
const ENGLISH_PHRASES = [
  "manually",
  "manual step",
  "manual steps",
  "by hand",
  "the user must run",
  "the user must approve",
  "the user should run",
  "ask the user",
  "deploy to staging",
  "deploy to production",
  "deploy to prod",
  "check in the console",
  "set in the console",
  "you must run",
];
const SPANISH_PHRASES = [
  "manualmente",
  "a mano",
  "el usuario debe",
  "pide al usuario",
  "despliega en",
  "desplegar en",
  "revisa en la consola",
  "configura en la consola",
  "ejecuta tú",
];

function task(text: string, ...rest: string[]): string {
  return doc(`- [ ] 1.1 ${text}`, ...rest, VERIFY);
}

describe("lintTasks: manual-step", () => {
  test("English manual step", () => {
    expect(found(task("Deploy to staging and confirm the endpoint answers"))).toEqual([{ line: 1, rule: MANUAL_STEP }]);
  });

  test("phrase inside a code span", () => {
    expect(found(task("Add the `deploy to staging` label to the help text"))).toEqual([]);
  });

  test("phrase on a continuation line", () => {
    expect(found(doc("- [ ] 1.1 Publish the release notes", "  then deploy to production", VERIFY))).toEqual([
      { line: 1, rule: MANUAL_STEP },
    ]);
  });

  test("checked manual step", () => {
    expect(found(doc("- [x] 1.1 Deploy to staging"))).toEqual([]);
  });

  test("two phrases in one task give one finding", () => {
    expect(found(task("Manually deploy to staging"))).toEqual([{ line: 1, rule: MANUAL_STEP }]);
  });

  test("manual step without Verify", () => {
    expect(found("- [ ] 1.1 Deploy to staging")).toEqual([
      { line: 1, rule: NO_VERIFY },
      { line: 1, rule: MANUAL_STEP },
    ]);
  });

  test("every English phrase", () => {
    for (const phrase of ENGLISH_PHRASES) {
      expect(found(task(`Please ${phrase} now`))).toEqual([{ line: 1, rule: MANUAL_STEP }]);
    }
  });

  test("every Spanish phrase", () => {
    for (const phrase of SPANISH_PHRASES) {
      expect(found(task(`Por favor ${phrase} ahora`))).toEqual([{ line: 1, rule: MANUAL_STEP }]);
    }
  });

  test("Spanish manual step", () => {
    expect(found(task("El usuario debe aprobar el cambio en la consola"))).toEqual([{ line: 1, rule: MANUAL_STEP }]);
  });

  test("non-ASCII phrase before punctuation", () => {
    expect(found(task("Luego ejecuta tú."))).toEqual([{ line: 1, rule: MANUAL_STEP }]);
  });

  test("phrase inside a longer word", () => {
    expect(found(task("Document the redeploy to staging script"))).toEqual([]);
  });

  test("narrowed phrases", () => {
    for (const text of [
      "Print the error in the console",
      "The user must see an error toast",
      "The user should see the banner",
      "Deploy to the docs folder",
      "Muestra el error en la consola",
    ]) {
      expect(found(task(text))).toEqual([]);
    }
  });

  test("unlisted inflection", () => {
    expect(found(task("The script deploys to staging"))).toEqual([]);
  });

  test("existing human task", () => {
    expect(found(task("Open the PR"))).toEqual([]);
  });

  test("human task inside a code span", () => {
    expect(found(task("Ask the user to run `git push`"))).toEqual([]);
  });

  test("formatFinding names the rule and message", () => {
    const [finding] = lintTasks(task("Deploy to staging"));
    expect(formatFinding("demo", finding as NonNullable<typeof finding>)).toBe(
      "demo: tasks.md:1: manual-step task asks for a human action; move it to manual.md or describe the outcome the agent produces (text in backticks is ignored)",
    );
  });
});

const MISSING_CHECK = "missing-check";
const MANUAL_CHECKBOX = "manual-checkbox";
const CHECK = "  Check: it shows Approved";

function manualFound(markdown: string): Array<{ line: number; rule: string }> {
  return lintManual(markdown).map((finding) => ({ line: finding.line, rule: finding.rule }));
}

describe("lintManual: missing-check", () => {
  test("valid manual.md", () => {
    expect(manualFound(doc("- Approve", CHECK, "- Deploy", "  - Check: it is live"))).toEqual([]);
  });

  test("step without Check", () => {
    expect(manualFound(doc("- Approve", CHECK, "", "- Deploy"))).toEqual([{ line: 4, rule: MISSING_CHECK }]);
  });

  test("other list markers", () => {
    expect(manualFound(doc("* Approve", "1. Deploy"))).toEqual([
      { line: 1, rule: MISSING_CHECK },
      { line: 2, rule: MISSING_CHECK },
    ]);
  });

  test("check form", () => {
    for (const lines of [
      ["- Step", "  check: lowercase"],
      ["- Step", "  Check:"],
      ["- Step", "", "  Check: after blank"],
    ]) {
      expect(manualFound(doc(...lines))).toEqual([{ line: 1, rule: MISSING_CHECK }]);
    }
  });

  test("list item inside a fence", () => {
    expect(manualFound(doc(TICKS, "- no check", TICKS))).toEqual([]);
  });
});

describe("lintManual: manual-checkbox", () => {
  test("checkbox with a Check line", () => {
    expect(manualFound(doc("- [ ] Approve", CHECK))).toEqual([{ line: 1, rule: MANUAL_CHECKBOX }]);
  });

  test("checkbox without a Check line", () => {
    expect(manualFound(doc("- [x] Approve"))).toEqual([
      { line: 1, rule: MANUAL_CHECKBOX },
      { line: 1, rule: MISSING_CHECK },
    ]);
  });

  test("formatFinding with the manual.md file name", () => {
    const lines = lintManual(doc("# Manual", "", "- [x] Approve")).map((f) => formatFinding("demo", f, "manual.md"));
    expect(lines).toEqual([
      "demo: manual.md:3: manual-checkbox step has a checkbox; remove it so OpenSpec does not count it as a task",
      "demo: manual.md:3: missing-check step has no indented Check: line with text; add one under the step",
    ]);
  });
});

describe("parseManualSteps", () => {
  test("pairs in file order, marker and checkbox dropped, texts trimmed", () => {
    const steps = parseManualSteps(doc("- [ ]   Approve  ", "  Check:   shows Approved  ", "1. Deploy", "* [X] Verify", "  - Check: ok"));
    expect(steps).toEqual([
      { step: "Approve", check: "shows Approved" },
      { step: "Deploy", check: "" },
      { step: "Verify", check: "ok" },
    ]);
  });

  test("first matching continuation line wins", () => {
    expect(parseManualSteps(doc("- Step", "  note", "  Check: one", "  Check: two"))).toEqual([
      { step: "Step", check: "one" },
    ]);
  });

  test("ignores list items inside a fence", () => {
    expect(parseManualSteps(doc("- A", CHECK, TICKS, "- hidden", TICKS, "- B"))).toEqual([
      { step: "A", check: "it shows Approved" },
      { step: "B", check: "" },
    ]);
  });
});
