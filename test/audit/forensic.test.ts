import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditFiles, auditSource, formatForensicReport } from "../../src/audit/forensic";

describe("auditSource", () => {
  test("reports explicit any and inline body comments with line numbers", () => {
    const source = "export function f(x: any): number {\n  // explain what happens\n  return x;\n}\n";
    const violations = auditSource("src/sample.ts", source);
    expect(violations.map((violation) => violation.rule)).toEqual(["explicit-any", "inline-body-comment"]);
    expect(violations[0]?.line).toBe(1);
    expect(violations[1]?.line).toBe(2);
  });

  test("ignores any and comment markers inside string and template literals", () => {
    const source = [
      "export function fixture(): string[] {",
      '  const a = "export function bad(input: any) { // stub }";',
      "  const b = `/* block */ ${a} // trailing`;",
      "  return [a, b];",
      "}",
    ].join("\n");
    expect(auditSource("src/sample.ts", source)).toEqual([]);
  });

  test("allows module-level comments and JSDoc docblocks", () => {
    const source = [
      "// module level note",
      "/** Why this exists. */",
      "export function ok(): number {",
      "  /** Inline JSDoc is documentation of a nested declaration. */",
      "  const value = 1;",
      "  return value;",
      "}",
    ].join("\n");
    expect(auditSource("src/sample.ts", source)).toEqual([]);
  });

  test("reports trailing and block comments in arrow functions and methods", () => {
    const source = [
      "export const arrow = (): number => {",
      "  return 1; /* trailing block */",
      "};",
      "export class Worker {",
      "  run(): void {",
      "    console.log(1); // trailing line",
      "  }",
      "}",
    ].join("\n");
    const rules = auditSource("src/sample.ts", source).map((violation) => violation.line);
    expect(rules).toEqual([2, 6]);
  });

  test("reports mock, mock.module, spyOn and jest calls in E2E tests", () => {
    const source = [
      'import { mock, spyOn } from "bun:test";',
      "mock(() => 1);",
      'mock.module("x", () => ({}));',
      "spyOn(console, 'log');",
      "jest.fn();",
      "const reference_pal = 1;",
    ].join("\n");
    const violations = auditSource("test/e2e/tier1_features/sample.test.ts", source);
    expect(violations.filter((violation) => violation.rule === "e2e-stub")).toHaveLength(5);
  });

  test("does not apply E2E stub rule outside test/e2e", () => {
    const source = "mock(() => 1);\n";
    expect(auditSource("test/core/sample.test.ts", source)).toEqual([]);
  });

  test("reports placeholder throws only in production files", () => {
    const source = 'export function todo(): never {\n  throw new Error("not implemented");\n}\n';
    expect(auditSource("src/sample.ts", source).map((violation) => violation.rule)).toEqual([
      "placeholder-implementation",
    ]);
    expect(auditSource("test/sample.test.ts", source)).toEqual([]);
  });
});

describe("auditFiles", () => {
  test("expands directories, skips fixtures, and formats a FAIL report", () => {
    const root = mkdtempSync(join(tmpdir(), "cascade-forensic-"));
    try {
      mkdirSync(join(root, "src", "fixtures"), { recursive: true });
      writeFileSync(join(root, "src", "clean.ts"), "export const a = 1;\n");
      writeFileSync(join(root, "src", "dirty.ts"), "export const b: any = 1;\n");
      writeFileSync(join(root, "src", "fixtures", "ignored.ts"), "export const c: any = 1;\n");
      const report = auditFiles(root, ["src", "missing"]);
      expect(report.filesAudited).toBe(2);
      expect(report.violations).toHaveLength(1);
      const formatted = formatForensicReport(report);
      expect(formatted).toContain("src/dirty.ts:1 [explicit-any]");
      expect(formatted).toContain("forensic-audit FAIL: 2 files audited, 1 violations");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the repository audit scope is clean", () => {
    const report = auditFiles(process.cwd());
    expect(formatForensicReport(report)).toContain("forensic-audit PASS");
  });
});
