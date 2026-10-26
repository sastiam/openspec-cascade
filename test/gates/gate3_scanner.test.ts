/**
 * Unit Test Suite for Gate 3: Anti-Cheat & Forensic Integrity Scanner (Task 1.2).
 *
 * Validates detection of placeholders, dummy stubs, disabled assertions, test evasion,
 * mocked test suites, harness hijacking, pluggable rule registration, diff parsing,
 * and reporting in accordance with OpenSpec change `looper-gate3-forensic-audit` Task 1.2
 * and `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.5.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATE3_SCANNER_CONSTANTS,
  Gate3AntiCheatScanner,
  createGate3AntiCheatScanner,
  formatAntiCheatReportMarkdown,
  formatAntiCheatReportXml,
  isProductionFile,
  isTestFile,
  parseUnifiedDiff,
  ruleAssertionSuppression,
  ruleCommentedAssertion,
  ruleDisabledTestSkip,
  ruleDisabledTestTodo,
  ruleDummyReturnProd,
  ruleEmptyTestBody,
  ruleExcessiveMocking,
  ruleHardcodedFacade,
  ruleIsolatedTestOnly,
  ruleMockInProduction,
  ruleMockedSubjectUnderTest,
  rulePlaceholderStub,
  rulePlaceholderTodo,
  rulePlaceholderUnimplemented,
  ruleTestHarnessHijacking,
  ruleTrivialAssertion,
  scanAntiCheatContent,
  scanAntiCheatDiff,
  toGate3InvariantCheckResult,
  type AntiCheatRule,
  type AntiCheatScanReport,
  type AntiCheatViolation,
} from "../../src/gates/gate3_scanner";
import {
  Gate3Auditor,
  createGate3Auditor,
  type Gate3ExecutionContext,
} from "../../src/gates/gate3_audit";

/**
 * Central test constants ensuring zero magic numbers.
 */
const TEST_CONSTANTS = {
  NUM_ZERO: 0,
  NUM_ONE: 1,
  NUM_TWO: 2,
  NUM_THREE: 3,
  NUM_FOUR: 4,
  EXPECTED_TOTAL_BUILTIN_RULES: 16,
  EXIT_CODE_ZERO: 0,
} as const;

describe("Gate 3: Anti-Cheat & Forensic Integrity Scanner (Task 1.2)", () => {
  let tempDir: string;
  let srcDir: string;
  let testDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `gate3-scanner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    srcDir = join(tempDir, "src");
    testDir = join(tempDir, "test");
    await mkdir(srcDir, { recursive: true });
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("GATE3_SCANNER_CONSTANTS & Taxonomy", () => {
    it("exposes canonical anti-cheat category identifiers", () => {
      expect(GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS).toBe("placeholders");
      expect(GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS).toBe("disabled_assertions");
      expect(GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES).toBe("mocked_test_suites");
      expect(GATE3_SCANNER_CONSTANTS.CATEGORY_CUSTOM).toBe("custom");
    });

    it("exposes canonical severity identifiers", () => {
      expect(GATE3_SCANNER_CONSTANTS.SEVERITY_VETO).toBe("veto");
      expect(GATE3_SCANNER_CONSTANTS.SEVERITY_WARNING).toBe("warning");
    });

    it("exposes standard rule identifiers", () => {
      expect(GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_TODO).toBe("AC-001-PLACEHOLDER-TODO");
      expect(GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_STUB).toBe("AC-002-PLACEHOLDER-STUB");
      expect(GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_UNIMPLEMENTED).toBe("AC-003-PLACEHOLDER-UNIMPLEMENTED");
      expect(GATE3_SCANNER_CONSTANTS.RULE_DUMMY_RETURN_PROD).toBe("AC-004-DUMMY-RETURN-PROD");
      expect(GATE3_SCANNER_CONSTANTS.RULE_MOCK_IN_PRODUCTION).toBe("AC-005-MOCK-IN-PRODUCTION");
      expect(GATE3_SCANNER_CONSTANTS.RULE_HARDCODED_FACADE).toBe("AC-006-HARDCODED-FACADE");

      expect(GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_SKIP).toBe("AC-010-DISABLED-TEST-SKIP");
      expect(GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_TODO).toBe("AC-011-DISABLED-TEST-TODO");
      expect(GATE3_SCANNER_CONSTANTS.RULE_ISOLATED_TEST_ONLY).toBe("AC-012-ISOLATED-TEST-ONLY");
      expect(GATE3_SCANNER_CONSTANTS.RULE_COMMENTED_ASSERTION).toBe("AC-013-COMMENTED-ASSERTION");
      expect(GATE3_SCANNER_CONSTANTS.RULE_TRIVIAL_ASSERTION).toBe("AC-014-TRIVIAL-ASSERTION");
      expect(GATE3_SCANNER_CONSTANTS.RULE_EMPTY_TEST_BODY).toBe("AC-015-EMPTY-TEST-BODY");
      expect(GATE3_SCANNER_CONSTANTS.RULE_ASSERTION_SUPPRESSION).toBe("AC-016-ASSERTION-SUPPRESSION");

      expect(GATE3_SCANNER_CONSTANTS.RULE_MOCKED_SUBJECT_UNDER_TEST).toBe("AC-020-MOCKED-SUBJECT-UNDER-TEST");
      expect(GATE3_SCANNER_CONSTANTS.RULE_TEST_HARNESS_HIJACKING).toBe("AC-021-TEST-HARNESS-HIJACKING");
      expect(GATE3_SCANNER_CONSTANTS.RULE_EXCESSIVE_MOCKING).toBe("AC-022-EXCESSIVE-MOCKING");
    });

    it("defines authoritative citations for compliance", () => {
      expect(GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE).toContain("Harness as Oracle Axiom");
      expect(GATE3_SCANNER_CONSTANTS.CITATION_GATE3_VETO).toContain("Gate 3 Forensic Auditor");
      expect(GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD).toContain("mock responses in production");
    });
  });

  describe("File Classification & Unified Diff Parsing", () => {
    it("correctly identifies production vs test files across Linux and Windows paths", () => {
      expect(isProductionFile("src/engine/worker.ts")).toBe(true);
      expect(isProductionFile("/workspace/src/gates/gate3.ts")).toBe(true);
      expect(isProductionFile("C:\\repo\\src\\service.ts")).toBe(true);

      expect(isProductionFile("test/gates/gate3.test.ts")).toBe(false);
      expect(isProductionFile("src/gates/gate3.test.ts")).toBe(false);
      expect(isProductionFile("docs/readme.md")).toBe(false);

      expect(isTestFile("test/gates/gate3_audit.test.ts")).toBe(true);
      expect(isTestFile("tests/unit/spec.ts")).toBe(true);
      expect(isTestFile("src/feature.spec.ts")).toBe(true);
      expect(isTestFile("src/service.ts")).toBe(false);
    });

    it("parses unified diff and extracts file headers and accurate line numbers", () => {
      const sampleDiff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -10,3 +10,4 @@",
        " const a = 1;",
        "+const b = 2;",
        "+const c = 3;",
        " const d = 4;",
      ].join("\n");

      const sections = parseUnifiedDiff(sampleDiff);
      expect(sections.length).toBe(TEST_CONSTANTS.NUM_ONE);
      expect(sections[0]?.filePath).toBe("src/service.ts");
      expect(sections[0]?.addedLines.length).toBe(TEST_CONSTANTS.NUM_TWO);
      expect(sections[0]?.addedLines[0]?.line).toBe("const b = 2;");
      expect(sections[0]?.addedLines[0]?.lineNumber).toBe(11);
      expect(sections[0]?.addedLines[1]?.line).toBe("const c = 3;");
      expect(sections[0]?.addedLines[1]?.lineNumber).toBe(12);
    });
  });

  describe("Category 1: Placeholders & Dummy Stubs in Production Code", () => {
    it("flags unfinished TODO/FIXME comments in production files", async () => {
      const code = [
        "export function calculateRate() {",
        "  // TODO: implement dynamic tax computation",
        "  return 0.15;",
        "}",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "src/tax.ts");

      expect(report.passed).toBe(false);
      expect(report.veto).toBe(true);
      expect(report.vetoViolations).toBe(TEST_CONSTANTS.NUM_ONE);
      expect(report.violations[0]?.ruleId).toBe(GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_TODO);
      expect(report.violations[0]?.description).toContain("TODO");
    });

    it("flags explicit stub and placeholder comments in production code", async () => {
      const code = [
        "export function getSessionData() {",
        "  // placeholder implementation",
        "  return { valid: true };",
        "}",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "src/session.ts");

      expect(report.passed).toBe(false);
      expect(report.vetoViolations).toBe(TEST_CONSTANTS.NUM_ONE);
      expect(report.violations[0]?.ruleId).toBe(GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_STUB);
    });

    it("flags unimplemented exceptions thrown as stubs in production files", async () => {
      const code = [
        "export function handleEvent() {",
        "  throw new Error('not implemented yet');",
        "}",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "src/handler.ts");

      expect(report.passed).toBe(false);
      expect(report.violations[0]?.ruleId).toBe(
        GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_UNIMPLEMENTED
      );
    });

    it("flags dummy stub returns (`return null as any; // stub`) in production code", async () => {
      const code = [
        "export function resolveUser() {",
        "  return null as any; // stub",
        "}",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "src/user.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_DUMMY_RETURN_PROD)).toBe(true);
      expect(report.violations[0]?.description).toContain("Mock placeholder or dummy stub in production code");
    });

    it("flags test mock utilities imported or invoked in production code", async () => {
      const code = [
        "import { mock } from 'bun:test';",
        "export const mockService = mock(() => ({ status: 'ok' }));",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "src/client.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_MOCK_IN_PRODUCTION)).toBe(true);
    });

    it("flags facade comments in production code", async () => {
      const code = [
        "export function getAuthToken() {",
        "  // facade token",
        "  return 'fixed-token';",
        "}",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "src/auth.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_HARDCODED_FACADE)).toBe(true);
    });

    it("does NOT flag TODO comments in test or documentation files", async () => {
      const code = [
        "// TODO: note for future test expansion",
        "describe('suite', () => { it('passes', () => { expect(1 + 2).toBe(3); }); });",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "test/tax.test.ts");
      expect(report.passed).toBe(true);
    });
  });

  describe("Category 2: Disabled Assertions & Test Evasion", () => {
    it("flags test.skip, it.skip, describe.skip in test files", async () => {
      const testCode = [
        "describe.skip('evaded suite', () => {",
        "  it('passes', () => { expect(2 + 2).toBe(4); });",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/suite.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_SKIP)).toBe(true);
      expect(report.violations[0]?.description).toContain("Disabled or skipped test suite detected");
    });

    it("flags xit and xtest evasion prefixes", async () => {
      const testCode = [
        "describe('suite', () => {",
        "  xit('skipped case', () => { expect(1).toBe(2); });",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/xprefix.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_SKIP)).toBe(true);
    });

    it("flags test.todo in test files", async () => {
      const testCode = [
        "describe('suite', () => {",
        "  test.todo('future implementation');",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/todo.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_TODO)).toBe(true);
    });

    it("flags test.only or fit isolating test execution", async () => {
      const testCode = [
        "describe('suite', () => {",
        "  it.only('isolated test case', () => { expect(10).toBe(10); });",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/only.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_ISOLATED_TEST_ONLY)).toBe(true);
    });

    it("flags commented-out assertions in test files", async () => {
      const testCode = [
        "describe('suite', () => {",
        "  it('executes without real assertion', () => {",
        "    const res = runTask();",
        "    // expect(res).toBe('expected');",
        "  });",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/commented.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_COMMENTED_ASSERTION)).toBe(true);
    });

    it("flags trivial, self-attesting tautological assertions", async () => {
      const testCases = [
        "expect(true).toBe(true);",
        "expect(false).toBe(false);",
        "expect(1).toBe(1);",
        "expect(0).toBe(0);",
        "expect('success').toBe('success');",
        "expect(variable).toBe(variable);",
        "expect(true).toBeTruthy();",
        "expect(false).toBeFalsy();",
        "expect(null).toBeNull();",
        "expect(undefined).toBeUndefined();",
        "assert(true);",
        "expect(1 + 1).toBe(2);",
      ];

      for (const line of testCases) {
        const scanner = createGate3AntiCheatScanner();
        const report = await scanner.scanContent(line, "test/tautology.test.ts");
        expect(report.passed).toBe(false);
        expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_TRIVIAL_ASSERTION)).toBe(true);
        expect(report.violations[0]?.description).toContain("Trivial or self-attesting assertion detected");
      }
    });

    it("flags empty test bodies without assertions", async () => {
      const testCode = [
        "describe('suite', () => {",
        "  test('empty body test', () => {});",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/empty.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_EMPTY_TEST_BODY)).toBe(true);
    });

    it("flags assertion suppression in silent try-catch blocks", async () => {
      const testCode = [
        "describe('suite', () => {",
        "  it('swallows failure', () => {",
        "    try { expect(calculate()).toBe(100); } catch {}",
        "  });",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/suppressed.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_ASSERTION_SUPPRESSION)).toBe(true);
    });
  });

  describe("Category 3: Mocked Test Suites & Test Harness Hijacking", () => {
    it("flags mocking the primary subject-under-test in its own test suite", async () => {
      const testCode = [
        "import { mock } from 'bun:test';",
        "mock.module('../src/gates/gate3_audit', () => ({ Gate3Auditor: class {} }));",
        "describe('gate3 audit suite', () => {",
        "  it('runs fake test', () => { expect(1 + 2).toBe(3); });",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/gates/gate3_audit.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_MOCKED_SUBJECT_UNDER_TEST)).toBe(true);
      expect(report.violations[0]?.description).toContain("Mocked test suite detected: Unit under test");
    });

    it("flags monkey-patching global test framework assertion runner", async () => {
      const testCode = [
        "globalThis.expect = () => ({ toBe: () => true });",
        "it('always passes', () => { expect(1).toBe(2); });",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/hijack.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_TEST_HARNESS_HIJACKING)).toBe(true);
    });

    it("flags monkey-patching process.exit to fake zero exit code", async () => {
      const testCode = [
        "process.exit = () => { return 0 as never; };",
        "it('exits cleanly', () => {});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(testCode, "test/exit_hijack.test.ts");

      expect(report.passed).toBe(false);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_TEST_HARNESS_HIJACKING)).toBe(true);
    });

    it("flags excessive mocking when mock calls overwhelm genuine assertions", async () => {
      const testCode = [
        "const m1 = mock(() => {});",
        "const m2 = mock(() => {});",
        "const m3 = mock(() => {});",
        "const m4 = mock(() => {});",
        "const m5 = mock(() => {});",
        "const m6 = mock(() => {});",
        "const m7 = mock(() => {});",
        "const m8 = mock(() => {});",
        "it('has only one assertion vs eight mocks', () => {",
        "  expect(m1).toBeDefined();",
        "});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner({
        excessiveMockThreshold: 0.8,
        minMocksForExcessive: 5,
      });
      const report = await scanner.scanContent(testCode, "test/overmocked.test.ts");

      expect(report.warningViolations).toBeGreaterThanOrEqual(TEST_CONSTANTS.NUM_ONE);
      expect(report.violations.some((v) => v.ruleId === GATE3_SCANNER_CONSTANTS.RULE_EXCESSIVE_MOCKING)).toBe(true);
    });
  });

  describe("Scanner Execution Modes & Disk Integration", () => {
    it("scans git diff and correctly correlates file path and line numbers", async () => {
      const diff = [
        "diff --git a/src/service.ts b/src/service.ts",
        "--- a/src/service.ts",
        "+++ b/src/service.ts",
        "@@ -20,2 +20,4 @@",
        "+export function compute() {",
        "+  // TODO: implement",
        "+}",
        "diff --git a/test/service.test.ts b/test/service.test.ts",
        "--- a/test/service.test.ts",
        "+++ b/test/service.test.ts",
        "@@ -1,2 +1,3 @@",
        "+test.skip('evaded test', () => {",
        "+  expect(true).toBe(true);",
        "+});",
      ].join("\n");

      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanDiff(diff);

      expect(report.passed).toBe(false);
      expect(report.scannedFiles).toContain("src/service.ts");
      expect(report.scannedFiles).toContain("test/service.test.ts");
      expect(report.violations.length).toBe(TEST_CONSTANTS.NUM_THREE);
    });

    it("scans files on disk and reads content cleanly", async () => {
      const prodPath = join(srcDir, "real_service.ts");
      await writeFile(
        prodPath,
        "export function run() {\n  return 42;\n}\n",
        "utf-8"
      );

      const scanner = createGate3AntiCheatScanner({ repoRoot: tempDir });
      const report = await scanner.scanFiles(["src/real_service.ts"]);

      expect(report.passed).toBe(true);
      expect(report.totalViolations).toBe(TEST_CONSTANTS.NUM_ZERO);
      expect(report.scannedFiles).toContain("src/real_service.ts");
    });

    it("supports ignore patterns to exclude designated fixtures", async () => {
      const code = "test.skip('fixture test', () => {});";
      const scanner = createGate3AntiCheatScanner({
        ignorePatterns: [/fixtures[\\/]/, /\.fixture\./],
      });

      const report1 = await scanner.scanContent(code, "test/fixtures/cheat.test.ts");
      expect(report1.passed).toBe(true);
      expect(report1.totalViolations).toBe(TEST_CONSTANTS.NUM_ZERO);

      const report2 = await scanner.scanContent(code, "test/real.fixture.ts");
      expect(report2.passed).toBe(true);
    });
  });

  describe("Rule Management & Pluggability", () => {
    it("allows registering and unregistering custom anti-cheat rules", async () => {
      const customRule: AntiCheatRule = {
        id: "CUSTOM-001-FORBIDDEN-KEYWORD",
        name: "Forbidden Keyword Rule",
        category: GATE3_SCANNER_CONSTANTS.CATEGORY_CUSTOM,
        severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
        description: "Detects forbidden keyword",
        ruleCitation: "Custom policy",
        appliesTo: "all",
        evaluate(context) {
          if (context.content.includes("FORBIDDEN_HACK")) {
            return [
              {
                ruleId: "CUSTOM-001-FORBIDDEN-KEYWORD",
                ruleName: "Forbidden Keyword Rule",
                category: GATE3_SCANNER_CONSTANTS.CATEGORY_CUSTOM,
                severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
                description: "Forbidden hack discovered in file",
                file: context.filePath,
              },
            ];
          }
          return [];
        },
      };

      const scanner = createGate3AntiCheatScanner();
      scanner.registerRule(customRule);

      const reportWithCustom = await scanner.scanContent(
        "const a = 'FORBIDDEN_HACK';",
        "src/custom.ts"
      );
      expect(reportWithCustom.passed).toBe(false);
      expect(reportWithCustom.violations.some((v) => v.ruleId === "CUSTOM-001-FORBIDDEN-KEYWORD")).toBe(true);

      const removed = scanner.unregisterRule("CUSTOM-001-FORBIDDEN-KEYWORD");
      expect(removed).toBe(true);

      const reportAfterRemoval = await scanner.scanContent(
        "const a = 'FORBIDDEN_HACK';",
        "src/custom.ts"
      );
      expect(reportAfterRemoval.passed).toBe(true);
    });

    it("allows disabling built-in rules via disabledRuleIds option", async () => {
      const scanner = createGate3AntiCheatScanner({
        disabledRuleIds: [GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_TODO],
      });

      const report = await scanner.scanContent(
        "// TODO: implement later\nexport const x = 1;",
        "src/x.ts"
      );
      expect(report.passed).toBe(true);
    });
  });

  describe("Reporting & Formatting", () => {
    it("converts scan report into canonical Gate3InvariantCheckResult", async () => {
      const code = "// TODO: implement\nexport function f() {}";
      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "src/f.ts");
      const invariantResult = toGate3InvariantCheckResult(report);

      expect(invariantResult.name).toBe("anti_cheat_integrity");
      expect(invariantResult.category).toBe("anti_cheat");
      expect(invariantResult.passed).toBe(false);
      expect(invariantResult.status).toBe("violated");
      expect(invariantResult.violations.length).toBe(TEST_CONSTANTS.NUM_ONE);
      expect(invariantResult.remediation).toBeDefined();
    });

    it("formats comprehensive markdown report with breakdown and snippets", async () => {
      const code = "test.skip('evaded', () => { expect(true).toBe(true); });";
      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "test/f.test.ts");
      const md = formatAntiCheatReportMarkdown(report);

      expect(md).toContain("# Gate 3 Anti-Cheat Forensic Report");
      expect(md).toContain("⛔ VETO");
      expect(md).toContain("## Violations Breakdown by Category");
      expect(md).toContain("Disabled Assertions & Evasion");
      expect(md).toContain("test/f.test.ts");
    });

    it("formats structured XML report for agent diagnostic escalation", async () => {
      const code = "test.skip('evaded', () => {});";
      const scanner = createGate3AntiCheatScanner();
      const report = await scanner.scanContent(code, "test/f.test.ts");
      const xml = formatAntiCheatReportXml(report);

      expect(xml).toContain("<anti-cheat-report>");
      expect(xml).toContain("<passed>false</passed>");
      expect(xml).toContain("<veto>true</veto>");
      expect(xml).toContain("<rule-id>AC-010-DISABLED-TEST-SKIP</rule-id>");
      expect(xml).toContain("</anti-cheat-report>");
    });

    it("provides convenience helpers scanAntiCheatDiff and scanAntiCheatContent", async () => {
      const contentRes = await scanAntiCheatContent("const a = 1;", "src/clean.ts");
      expect(contentRes.passed).toBe(true);

      const diffRes = await scanAntiCheatDiff(
        "+++ b/src/f.ts\n+return null as any; // stub"
      );
      expect(diffRes.passed).toBe(false);
    });
  });

  describe("Integration with Gate 3 Auditor Orchestrator", () => {
    it("integrates seamlessly into Gate3Auditor and triggers binary veto upon cheat detection", async () => {
      const diffCheat = [
        "diff --git a/src/core.ts b/src/core.ts",
        "--- a/src/core.ts",
        "+++ b/src/core.ts",
        "@@ -5,2 +5,4 @@",
        "+export function execute() {",
        "+  return null as any; // stub",
        "+}",
      ].join("\n");

      const auditor = createGate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        diff: diffCheat,
        skipCleanRoomQa: true,
      });

      const result = await auditor.run();
      expect(result.verdict).toBe("FAIL");
      expect(result.veto).toBe(true);
      expect(result.recommendedEvent).toBe("EVT_G3_VETO");
      expect(result.report.violations.some((v) => v.category === "anti_cheat")).toBe(true);
    });

    it("passes Gate 3 when code and tests contain authentic, non-cheat implementations", async () => {
      const cleanDiff = [
        "diff --git a/src/calculator.ts b/src/calculator.ts",
        "--- a/src/calculator.ts",
        "+++ b/src/calculator.ts",
        "@@ -1,1 +1,4 @@",
        "+export function add(a: number, b: number): number {",
        "+  return a + b;",
        "+}",
        "diff --git a/test/calculator.test.ts b/test/calculator.test.ts",
        "--- a/test/calculator.test.ts",
        "+++ b/test/calculator.test.ts",
        "@@ -1,1 +1,5 @@",
        "+import { add } from '../src/calculator';",
        "+it('adds two numbers', () => {",
        "+  expect(add(2, 3)).toBe(5);",
        "+});",
      ].join("\n");

      const auditor = createGate3Auditor({
        workspaceRoot: tempDir,
        repoRoot: tempDir,
        diff: cleanDiff,
        skipCleanRoomQa: true,
      });

      const result = await auditor.run();
      expect(result.verdict).toBe("PASS");
      expect(result.veto).toBe(false);
      expect(result.recommendedEvent).toBe("EVT_G3_PASS");
      expect(result.report.violations.length).toBe(TEST_CONSTANTS.NUM_ZERO);
    });
  });
});
