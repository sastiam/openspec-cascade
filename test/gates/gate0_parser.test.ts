/**
 * Unit Test Suite for Gate 0 Structured Compiler Error & Stack Trace Parser.
 *
 * Validates the trace parsing and XML feedback formatting implemented in `src/gates/gate0_parser.ts`
 * in accordance with OpenSpec change `looper-gate0-mechanical-qa` Task 1.2
 * and `projects/agnostic_looper/SPECIFICATION.md` Section 3.2.
 */

import { describe, expect, it } from "bun:test";
import {
  GATE0_PARSER_CONSTANTS,
  escapeXml,
  escapeXmlAttr,
  formatFailureXml,
  formatGate0Feedback,
  parseGate0Trace,
  parseLinterErrors,
  parseStackTrace,
  parseTestFailures,
  parseTypeScriptErrors,
  stripAnsi,
  type Gate0CheckExecutionResult,
  type Gate0Result,
} from "../../src/gates/gate0_qa";

describe("Gate 0: Structured Compiler Error & Stack Trace Parser (Task 1.2)", () => {
  describe("stripAnsi", () => {
    it("returns empty string for empty input", () => {
      expect(stripAnsi("")).toBe("");
    });

    it("strips 16-color, 256-color, bold, and cursor control ANSI sequences", () => {
      const colored = "\u001b[31mError:\u001b[39m \u001b[1mTS2322\u001b[22m in \u001b[4msrc/index.ts\u001b[24m";
      expect(stripAnsi(colored)).toBe("Error: TS2322 in src/index.ts");

      const cursor = "\u001b[2K\u001b[1GRunning bun test...";
      expect(stripAnsi(cursor)).toBe("Running bun test...");
    });
  });

  describe("escapeXml and escapeXmlAttr", () => {
    it("escapes XML content entities", () => {
      expect(escapeXml("Promise<string> & Array<number>")).toBe(
        "Promise&lt;string&gt; &amp; Array&lt;number&gt;",
      );
    });

    it("escapes quotes and apostrophes in attribute values", () => {
      const attr = `error in "file.ts" & 'test.ts' <spec>`;
      expect(escapeXmlAttr(attr)).toBe(
        "error in &quot;file.ts&quot; &amp; &apos;test.ts&apos; &lt;spec&gt;",
      );
    });
  });

  describe("parseTypeScriptErrors", () => {
    it("parses standard colon-separated TypeScript compiler output", () => {
      const output = [
        "src/core/dag.ts:45:10 - error TS2304: Cannot find name 'scheduler'.",
        "src/gates/gate0_qa.ts:120:5 - error TS2322: Type 'number' is not assignable to type 'string'.",
      ].join("\n");

      const diags = parseTypeScriptErrors(output);
      expect(diags).toHaveLength(2);

      expect(diags[0]?.file).toBe("src/core/dag.ts");
      expect(diags[0]?.line).toBe(45);
      expect(diags[0]?.column).toBe(10);
      expect(diags[0]?.code).toBe("TS2304");
      expect(diags[0]?.severity).toBe("error");
      expect(diags[0]?.source).toBe("tsc");
      expect(diags[0]?.message).toBe("Cannot find name 'scheduler'.");

      expect(diags[1]?.file).toBe("src/gates/gate0_qa.ts");
      expect(diags[1]?.line).toBe(120);
      expect(diags[1]?.column).toBe(5);
      expect(diags[1]?.code).toBe("TS2322");
    });

    it("parses parenthesized MSBuild / alternate format", () => {
      const output =
        "src/config.ts(15,8): error TS2307: Cannot find module './missing' or its corresponding type declarations.";
      const diags = parseTypeScriptErrors(output);

      expect(diags).toHaveLength(1);
      expect(diags[0]?.file).toBe("src/config.ts");
      expect(diags[0]?.line).toBe(15);
      expect(diags[0]?.column).toBe(8);
      expect(diags[0]?.code).toBe("TS2307");
    });

    it("parses TypeScript warnings with severity 'warning'", () => {
      const output =
        "src/index.ts:12:3 - warning TS6133: 'unusedVar' is declared but its value is never read.";
      const diags = parseTypeScriptErrors(output);

      expect(diags).toHaveLength(1);
      expect(diags[0]?.severity).toBe("warning");
      expect(diags[0]?.code).toBe("TS6133");
    });

    it("aggregates multi-line explanation details into message", () => {
      const output = [
        "src/app.ts:50:9 - error TS2322: Type '{ a: number }' is not assignable to type 'Target'.",
        "  Types of property 'a' are incompatible.",
        "    Type 'number' is not assignable to type 'string'.",
        "50   const x: Target = { a: 123 };",
        "                        ~~~~~~~",
      ].join("\n");

      const diags = parseTypeScriptErrors(output);
      expect(diags).toHaveLength(1);
      expect(diags[0]?.message).toContain("Type '{ a: number }' is not assignable to type 'Target'.");
      expect(diags[0]?.message).toContain("Types of property 'a' are incompatible.");
      expect(diags[0]?.message).toContain("Type 'number' is not assignable to type 'string'.");
      expect(diags[0]?.message).not.toContain("~~~~~~~");
    });

    it("respects maxDiagnostics limit", () => {
      const lines = Array.from(
        { length: 10 },
        (_, i) => `src/file_${i}.ts:${i + 1}:1 - error TS2304: Cannot find name 'foo'.`,
      );
      const diags = parseTypeScriptErrors(lines.join("\n"), 3);
      expect(diags).toHaveLength(3);
    });
  });

  describe("parseLinterErrors", () => {
    it("parses ESLint stylish format with file headers", () => {
      const stylishOutput = [
        "/home/sastiam/Workspace/openspec-cascade/src/gates/gate0_qa.ts",
        "  10:5   error    Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any",
        "  25:12  warning  Missing return type                       @typescript-eslint/explicit-function-return-type",
        "",
        "✖ 2 problems (1 error, 1 warning)",
      ].join("\n");

      const diags = parseLinterErrors(stylishOutput);
      expect(diags).toHaveLength(2);

      expect(diags[0]?.file).toBe("/home/sastiam/Workspace/openspec-cascade/src/gates/gate0_qa.ts");
      expect(diags[0]?.line).toBe(10);
      expect(diags[0]?.column).toBe(5);
      expect(diags[0]?.severity).toBe("error");
      expect(diags[0]?.code).toBe("@typescript-eslint/no-explicit-any");
      expect(diags[0]?.message).toBe("Unexpected any. Specify a different type");
      expect(diags[0]?.source).toBe("eslint");

      expect(diags[1]?.severity).toBe("warning");
      expect(diags[1]?.code).toBe("@typescript-eslint/explicit-function-return-type");
    });

    it("parses ESLint compact and unix output formats", () => {
      const compactOutput =
        "src/util.ts: line 40, col 3, Error - Missing semicolon (@typescript-eslint/semi)";
      const diags = parseLinterErrors(compactOutput);

      expect(diags).toHaveLength(1);
      expect(diags[0]?.file).toBe("src/util.ts");
      expect(diags[0]?.line).toBe(40);
      expect(diags[0]?.column).toBe(3);
      expect(diags[0]?.code).toBe("@typescript-eslint/semi");
      expect(diags[0]?.message).toBe("Missing semicolon");
    });

    it("parses Biome lint format", () => {
      const biomeOutput =
        "src/index.ts:15:3 lint/suspicious/noExplicitAny  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━";
      const diags = parseLinterErrors(biomeOutput);

      expect(diags).toHaveLength(1);
      expect(diags[0]?.file).toBe("src/index.ts");
      expect(diags[0]?.line).toBe(15);
      expect(diags[0]?.column).toBe(3);
      expect(diags[0]?.code).toBe("lint/suspicious/noExplicitAny");
      expect(diags[0]?.source).toBe("biome");
    });
  });

  describe("parseStackTrace", () => {
    it("parses named function stack frames and distinguishes project vs internal", () => {
      const trace = [
        "    at executeCommandCheck (src/gates/gate0_qa.ts:903:15)",
        "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
        "    at runSuite (bun:test:20:10)",
        "    at node_modules/lodash/lodash.js:500:2",
      ].join("\n");

      const frames = parseStackTrace(trace);
      expect(frames).toHaveLength(4);

      // Project frame
      expect(frames[0]?.functionName).toBe("executeCommandCheck");
      expect(frames[0]?.file).toBe("src/gates/gate0_qa.ts");
      expect(frames[0]?.line).toBe(903);
      expect(frames[0]?.column).toBe(15);
      expect(frames[0]?.isProject).toBe(true);
      expect(frames[0]?.isInternal).toBe(false);

      // Node internal frame
      expect(frames[1]?.isInternal).toBe(true);
      expect(frames[1]?.isProject).toBe(false);

      // Bun runtime frame
      expect(frames[2]?.isInternal).toBe(true);
      expect(frames[2]?.isProject).toBe(false);

      // node_modules frame
      expect(frames[3]?.isInternal).toBe(true);
      expect(frames[3]?.isProject).toBe(false);
    });

    it("parses anonymous frames without function names", () => {
      const trace = "    at test/gates/gate0.test.ts:258:12";
      const frames = parseStackTrace(trace);

      expect(frames).toHaveLength(1);
      expect(frames[0]?.functionName).toBeUndefined();
      expect(frames[0]?.file).toBe("test/gates/gate0.test.ts");
      expect(frames[0]?.line).toBe(258);
      expect(frames[0]?.column).toBe(12);
      expect(frames[0]?.isProject).toBe(true);
    });
  });

  describe("parseTestFailures", () => {
    it("parses Bun test failure headers, expectations, and attached stack frames", () => {
      const bunOutput = [
        "(fail) test/gates/gate0.test.ts > Gate0MechanicalRunner > stops on first failure [1.50ms]",
        "error: expect(received).toBe(expected)",
        "",
        "Expected: 0",
        "Received: 1",
        "",
        "      at test/gates/gate0.test.ts:258:12",
        "      at /home/sastiam/.bun/install/bun:test:15:3",
      ].join("\n");

      const failures = parseTestFailures(bunOutput);
      expect(failures).toHaveLength(1);

      expect(failures[0]?.testName).toBe("Gate0MechanicalRunner > stops on first failure");
      expect(failures[0]?.file).toBe("test/gates/gate0.test.ts");
      expect(failures[0]?.expected).toBe("0");
      expect(failures[0]?.received).toBe("1");
      expect(failures[0]?.message).toContain("expect(received).toBe(expected)");
      expect(failures[0]?.stackFrames.length).toBeGreaterThanOrEqual(1);
      expect(failures[0]?.stackFrames[0]?.file).toBe("test/gates/gate0.test.ts");
    });

    it("handles fallback assertion failure messages cleanly", () => {
      const assertionOnly = [
        "1 test failed: AssertionError: Expected values to be strictly equal",
        "Expected: 2",
        "Received: 1",
        "    at it (test/core/fsm.test.ts:50:7)",
      ].join("\n");

      const failures = parseTestFailures(assertionOnly);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.testName).toContain("AssertionError");
      expect(failures[0]?.expected).toBe("2");
      expect(failures[0]?.received).toBe("1");
      expect(failures[0]?.file).toBe("test/core/fsm.test.ts");
      expect(failures[0]?.line).toBe(50);
    });
  });

  describe("parseGate0Trace", () => {
    it("routes typecheck commands to TypeScript parser and produces summary", () => {
      const stderr = "src/index.ts:10:2 - error TS2304: Cannot find name 'foo'.";
      const trace = parseGate0Trace("", stderr, "typecheck", "bunx tsc --noEmit");

      expect(trace.diagnostics).toHaveLength(1);
      expect(trace.diagnostics[0]?.code).toBe("TS2304");
      expect(trace.summaryMessage).toContain("Compiler diagnostic in src/index.ts:10 [TS2304]");
    });

    it("routes test commands to test failure parser and produces summary", () => {
      const stdout = [
        "(fail) test/gates/gate0.test.ts > suite > test name",
        "error: assertion failed",
        "Expected: true",
        "Received: false",
      ].join("\n");

      const trace = parseGate0Trace(stdout, "", "test", "bun test");
      expect(trace.testFailures).toHaveLength(1);
      expect(trace.summaryMessage).toContain("Test failure in suite > test name");
    });
  });

  describe("formatFailureXml and formatGate0Feedback", () => {
    it("formats compiler error check into XML with <diagnostics> tags", () => {
      const checkFailure: Gate0CheckExecutionResult = {
        id: "gate0-typecheck",
        name: "TypeScript Compilation",
        type: "typecheck",
        command: "bunx tsc --noEmit",
        exitCode: 1,
        status: "failed",
        stdout: "",
        stderr: "src/index.ts:42:15 - error TS2322: Type 'string' is not assignable to type 'number'.",
        output: "src/index.ts:42:15 - error TS2322: Type 'string' is not assignable to type 'number'.",
        durationMs: 120,
        timedOut: false,
      };

      const xml = formatFailureXml(checkFailure);
      expect(xml).toContain('<failure check_id="gate0-typecheck" type="typecheck" command="bunx tsc --noEmit" exit_code="1"');
      expect(xml).toContain('<diagnostics count="1">');
      expect(xml).toContain('<diagnostic file="src/index.ts" line="42" column="15" code="TS2322" severity="error" source="tsc">');
      expect(xml).toContain("Type 'string' is not assignable to type 'number'.");
      expect(xml).toContain("</diagnostics>");
      expect(xml).toContain("<stderr>");
    });

    it("formats test runner check into XML with <test-failures> and <stack-trace>", () => {
      const checkFailure: Gate0CheckExecutionResult = {
        id: "gate0-test",
        name: "Unit Test",
        type: "test",
        command: "bun test",
        exitCode: 1,
        status: "failed",
        stdout: "",
        stderr: [
          "(fail) test/gates/gate0.test.ts > runner > fails fast",
          "error: expect(received).toBe(expected)",
          "Expected: 0",
          "Received: 1",
          "    at test/gates/gate0.test.ts:100:5",
        ].join("\n"),
        output: "error trace",
        durationMs: 80,
        timedOut: false,
      };

      const xml = formatFailureXml(checkFailure);
      expect(xml).toContain('<test-failures count="1">');
      expect(xml).toContain('<test-failure name="runner &gt; fails fast" file="test/gates/gate0.test.ts"');
      expect(xml).toContain("<expected>0</expected>");
      expect(xml).toContain("<received>1</received>");
      expect(xml).toContain("<stack-trace>");
      expect(xml).toContain('<frame file="test/gates/gate0.test.ts" line="100" column="5" internal="false" />');
      expect(xml).toContain("</stack-trace>");
    });

    it("formats overall Gate0Result into comprehensive feedback prompt", () => {
      const result: Gate0Result = {
        success: false,
        verdict: "FAILED",
        exitCode: 1,
        checks: [],
        failures: [
          {
            id: "gate0-lint",
            name: "Linter",
            type: "lint",
            command: "bun run lint",
            exitCode: 1,
            status: "failed",
            stdout: [
              "src/core/dag.ts",
              "  15:3  error  Unexpected any  @typescript-eslint/no-explicit-any",
            ].join("\n"),
            stderr: "",
            output: "lint error",
            durationMs: 50,
            timedOut: false,
          },
        ],
        passed: [],
        skipped: [],
        durationMs: 50,
        summary: "Gate 0 Oracle FAILED",
        fastTrackEligible: false,
        timestamp: new Date().toISOString(),
      };

      const feedback = formatGate0Feedback(result, {
        taskId: "1.2",
        attempt: 1,
        maxAttempts: 3,
      });

      expect(feedback).toContain("Task 1.2 is not done; Gate 0 automated mechanical QA checks failed (attempt 1/3).");
      expect(feedback).toContain('<verification-feedback gate="gate0" verdict="FAILED">');
      expect(feedback).toContain('<diagnostics count="1">');
      expect(feedback).toContain('file="src/core/dag.ts" line="15" column="3" code="@typescript-eslint/no-explicit-any"');
      expect(feedback).toContain("Unexpected any");
      expect(feedback).toContain("</verification-feedback>");
      expect(feedback).toContain("Analyze the failure traces, fix the underlying root causes, and re-verify");
    });
  });
});
