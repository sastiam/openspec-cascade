/**
 * Gate 3: Anti-Cheat & Forensic Integrity Scanner Engine.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.5 (LOOPER-GATE-004),
 * Section 1.2 (Harness as Oracle Axiom), and OpenSpec change
 * `looper-gate3-forensic-audit` Task 1.2.
 *
 * Provides rigorous, multi-vector anti-cheat detection:
 * 1. Placeholders & Dummy Stubs:
 *    - Unimplemented placeholder comments (TODO/FIXME/stub/dummy).
 *    - Dummy stub return statements (`return null as any; // stub`, empty literals).
 *    - Unimplemented placeholder errors (`throw new Error("not implemented")`).
 *    - Mock utilities or test imports leaking into production code (`src/**`).
 * 2. Disabled Assertions & Test Evasion:
 *    - Skipped test suites or cases (`.skip`, `.todo`, `xit`, `xtest`, `xdescribe`).
 *    - Focused/isolated tests (`.only`, `fit`, `fdescribe`) which bypass the rest of the suite.
 *    - Commented-out assertions (`// expect(...)`, block comment assertions).
 *    - Tautological, self-attesting trivial assertions (`expect(true).toBe(true)`, `expect(x).toBe(x)`).
 *    - Empty test bodies (`test("...", () => {})`) lacking empirical verification.
 *    - Swallowed assertions wrapped in silent `try { expect(...) } catch {}` blocks.
 * 3. Mocked Test Suites & Test Harness Hijacking:
 *    - Mocking the primary subject-under-test (SUT) inside its own test suite.
 *    - Monkey-patching global test runners (`globalThis.expect`, `global.test`, `process.exit`).
 *    - Excessive mocking exceeding verification thresholds.
 *
 * Adheres strictly to Zero Magic Numbers, Strict Typing, and Hexagonal Domain Isolation.
 */

import { readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, normalize, relative, resolve } from "node:path";
import type {
  Gate3ExecutionContext,
  Gate3InvariantCheckResult,
  Gate3Violation,
} from "./gate3_audit";

/**
 * Central constants ensuring zero magic numbers across anti-cheat scanning operations.
 */
export const GATE3_SCANNER_CONSTANTS = {
  // Invariant Category (matching Gate3)
  INVARIANT_CATEGORY: "anti_cheat" as const,
  INVARIANT_NAME: "anti_cheat_integrity" as const,

  // Anti-Cheat Categories
  CATEGORY_PLACEHOLDERS: "placeholders" as const,
  CATEGORY_DISABLED_ASSERTIONS: "disabled_assertions" as const,
  CATEGORY_MOCKED_SUITES: "mocked_test_suites" as const,
  CATEGORY_CUSTOM: "custom" as const,

  // Severities
  SEVERITY_VETO: "veto" as const,
  SEVERITY_WARNING: "warning" as const,

  // Statuses
  STATUS_PASSED: "passed" as const,
  STATUS_VIOLATED: "violated" as const,

  // Rule Identifiers
  RULE_PLACEHOLDER_TODO: "AC-001-PLACEHOLDER-TODO" as const,
  RULE_PLACEHOLDER_STUB: "AC-002-PLACEHOLDER-STUB" as const,
  RULE_PLACEHOLDER_UNIMPLEMENTED: "AC-003-PLACEHOLDER-UNIMPLEMENTED" as const,
  RULE_DUMMY_RETURN_PROD: "AC-004-DUMMY-RETURN-PROD" as const,
  RULE_MOCK_IN_PRODUCTION: "AC-005-MOCK-IN-PRODUCTION" as const,
  RULE_HARDCODED_FACADE: "AC-006-HARDCODED-FACADE" as const,

  RULE_DISABLED_TEST_SKIP: "AC-010-DISABLED-TEST-SKIP" as const,
  RULE_DISABLED_TEST_TODO: "AC-011-DISABLED-TEST-TODO" as const,
  RULE_ISOLATED_TEST_ONLY: "AC-012-ISOLATED-TEST-ONLY" as const,
  RULE_COMMENTED_ASSERTION: "AC-013-COMMENTED-ASSERTION" as const,
  RULE_TRIVIAL_ASSERTION: "AC-014-TRIVIAL-ASSERTION" as const,
  RULE_EMPTY_TEST_BODY: "AC-015-EMPTY-TEST-BODY" as const,
  RULE_ASSERTION_SUPPRESSION: "AC-016-ASSERTION-SUPPRESSION" as const,

  RULE_MOCKED_SUBJECT_UNDER_TEST: "AC-020-MOCKED-SUBJECT-UNDER-TEST" as const,
  RULE_TEST_HARNESS_HIJACKING: "AC-021-TEST-HARNESS-HIJACKING" as const,
  RULE_EXCESSIVE_MOCKING: "AC-022-EXCESSIVE-MOCKING" as const,

  // Rule Citations
  CITATION_AXIOM_ORACLE:
    "SPECIFICATION.md Section 3.1: The Harness as Oracle Axiom - An agent cannot self-attest or bypass verification." as const,
  CITATION_GATE3_VETO:
    "SPECIFICATION.md Section 3.5: Gate 3 Forensic Auditor Binary Veto & Invariant Enforcement." as const,
  CITATION_OPENSPEC_MOCK_PROD:
    "OpenSpec Scenario: An agent commits mock responses in production code -> triggers binary veto." as const,
  CITATION_OPENSPEC_TEST_HYGIENE:
    "SPECIFICATION.md Section 3.1 & 3.5: No test skipping, test isolation, or test evasion permitted." as const,

  // Regex Detection Patterns
  PATTERNS: {
    // 1. Placeholders & Stubs
    PLACEHOLDER_TODO: /\/\/\s*(?:TODO|FIXME|XXX)\s*:\s*(?:implement|placeholder|stub)/i,
    PLACEHOLDER_STUB: /\/\/\s*(?:placeholder|stub|dummy)\b/i,
    PLACEHOLDER_BLOCK_COMMENT: /\/\*\s*(?:placeholder|stub|dummy|TODO:\s*implement)\s*\*\//i,
    UNIMPLEMENTED_ERROR:
      /throw\s+new\s+(?:Error|NotImplementedError)\s*\(\s*["'](?:not implemented|unimplemented|TODO|stub|placeholder)/i,
    DUMMY_RETURN_STUB:
      /return\s+(?:null|\{\}|\[\]|false|0|""|undefined)\s*(?:as\s+any)?\s*;\s*\/\/\s*(?:stub|placeholder|dummy)/i,
    DUMMY_RETURN_ANY:
      /return\s+(?:null|\{\}|\[\])\s+as\s+any\s*;/i,
    FACADE_COMMENT:
      /\/\/\s*(?:facade|fake implementation|mock-response|hardcoded response)/i,

    // Mock in production code
    MOCK_IMPORTS_PROD:
      /(?:from\s+["']bun:test["']|from\s+["']jest["']|from\s+["']@jest\/globals["']|from\s+["']vitest["']|from\s+["']sinon["'])/,
    MOCK_CALLS_PROD:
      /\b(?:jest\.fn|jest\.mock|mock\.module|mock\s*\(|spyOn\s*\()/,

    // 2. Disabled Assertions & Evasion
    TEST_SKIP: /\b(?:test|it|describe|suite)\.skip\b/,
    TEST_TODO: /\b(?:test|it)\.todo\b/,
    TEST_X_PREFIX: /\b(?:xit|xtest|xdescribe)\s*\(/,
    TEST_ONLY: /\b(?:test|it|describe|suite)\.only\b/,
    TEST_F_PREFIX: /\b(?:fit|fdescribe)\s*\(/,
    COMMENTED_ASSERTION: /\/\/\s*(?:expect|assert|assertThat)\s*\(/,
    COMMENTED_ASSERTION_BLOCK: /\/\*\s*(?:expect|assert)\s*\(.*?\*\//,

    // Trivial & self-attesting assertions
    TRIVIAL_SAME_LITERAL:
      /expect\(\s*(true|false|1|0|null|undefined|NaN)\s*\)\.toBe\(\s*\1\s*\)/,
    TRIVIAL_STRING_LITERAL:
      /expect\(\s*(["'`])([^"'\\]*)\1\s*\)\.toBe\(\s*(["'`])\2\3\s*\)/,
    TRIVIAL_IDENTIFIER_MATCH:
      /expect\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)\.toBe\(\s*\1\s*\)/,
    TRIVIAL_BOOLEAN_HELPER:
      /expect\(\s*true\s*\)\.toBeTruthy\(\)|expect\(\s*false\s*\)\.toBeFalsy\(\)/,
    TRIVIAL_NULL_HELPER:
      /expect\(\s*null\s*\)\.toBeNull\(\)|expect\(\s*undefined\s*\)\.toBeUndefined\(\)|expect\(\s*NaN\s*\)\.toBeNaN\(\)/,
    TRIVIAL_ASSERT_CALL:
      /\bassert(?:\.ok)?\(\s*true\s*\)|\bassert(?:\.strictEqual|\.equal|\.deepEqual)?\(\s*(?:true\s*,\s*true|1\s*,\s*1|["']a["']\s*,\s*["']a["'])\s*\)/,
    TRIVIAL_ARITHMETIC_TAUTOLOGY:
      /expect\(\s*1\s*\+\s*1\s*\)\.toBe\(\s*2\s*\)/,

    // Empty test bodies & suppression
    EMPTY_TEST_BODY:
      /\b(?:test|it)\s*\(\s*["'`][^"'`]+["'`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/,
    ASSERTION_SUPPRESSION:
      /try\s*\{\s*expect\([^)]+\)[^}]*\}\s*catch\s*(?:\([^)]*\))?\s*\{\s*\}/,

    // 3. Mocked test suites & harness hijacking
    HARNESS_HIJACKING_EXPECT:
      /(?:global|globalThis|window)\.expect\s*=/,
    HARNESS_HIJACKING_TEST:
      /(?:global|globalThis|window)\.(?:test|it|describe)\s*=/,
    PROCESS_EXIT_HIJACKING:
      /process\.exit\s*=\s*/,
    MOCK_DEFINITION:
      /\b(?:mock\.module|mock\s*\(|jest\.mock|jest\.spyOn|spyOn\s*\()/,
    REAL_ASSERTION:
      /\b(?:expect\s*\(|assert\s*\(|assert\.[a-zA-Z]+)/,
  },

  // File Classification
  PRODUCTION_PATH_PREFIXES: ["src/"] as const,
  TEST_PATH_PATTERNS: [
    /(?:^|[\\/])test[\\/]/i,
    /(?:^|[\\/])tests[\\/]/i,
    /(?:^|[\\/])spec[\\/]/i,
    /(?:^|[\\/])specs[\\/]/i,
    /(?:^|[\\/])__tests__[\\/]/i,
    /\.(?:test|spec)\.[a-zA-Z0-9]+$/i,
  ] as const,

  // Thresholds & Constants
  DEFAULT_EXCESSIVE_MOCK_THRESHOLD: 0.8, // 80% mocks vs assertions
  DEFAULT_MIN_MOCKS_FOR_EXCESSIVE: 6,
  DIFF_HEADER_PREFIX_LENGTH: 6, // "+++ b/"
  DIFF_HUNK_PREFIX: "@@" as const,
  DIFF_PLUS_PREFIX: "+" as const,
  DIFF_MINUS_PREFIX: "-" as const,
  DIFF_FILE_HEADER: "diff --git" as const,
  MAX_SNIPPET_LENGTH: 120,
  MAX_DISPLAY_VIOLATIONS: 50,

  // Zero Magic Numbers
  NUM_ZERO: 0,
  NUM_ONE: 1,
  NUM_TWO: 2,
  NUM_THREE: 3,
  INDEX_NOT_FOUND: -1,
  SLICE_ONE: 1,
  PERCENT_MULTIPLIER: 100,
} as const;

/**
 * Categorization of anti-cheat rules.
 */
export type AntiCheatCategory =
  | typeof GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS
  | typeof GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS
  | typeof GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES
  | typeof GATE3_SCANNER_CONSTANTS.CATEGORY_CUSTOM;

/**
 * Severity assigned to an anti-cheat finding.
 */
export type AntiCheatSeverity =
  | typeof GATE3_SCANNER_CONSTANTS.SEVERITY_VETO
  | typeof GATE3_SCANNER_CONSTANTS.SEVERITY_WARNING;

/**
 * Structured violation detected by an anti-cheat scanner rule.
 */
export interface AntiCheatViolation {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly category: AntiCheatCategory;
  readonly severity: AntiCheatSeverity;
  readonly description: string;
  readonly file: string;
  readonly line?: number;
  readonly snippet?: string;
  readonly ruleCitation?: string;
  readonly remediation?: string;
}

/**
 * Context provided to an anti-cheat rule during file or diff evaluation.
 */
export interface AntiCheatRuleContext {
  readonly filePath: string;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly content: string;
  readonly lines: readonly string[];
  readonly addedLines?: readonly { line: string; lineNumber: number }[];
  readonly diffMode: boolean;
}

/**
 * Pluggable Anti-Cheat Rule Contract.
 */
export interface AntiCheatRule {
  readonly id: string;
  readonly name: string;
  readonly category: AntiCheatCategory;
  readonly severity: AntiCheatSeverity;
  readonly description: string;
  readonly ruleCitation: string;
  readonly appliesTo: "production" | "test" | "all";
  readonly evaluate: (
    context: AntiCheatRuleContext
  ) => AntiCheatViolation[] | Promise<AntiCheatViolation[]>;
}

/**
 * Comprehensive report generated by Gate 3 Anti-Cheat Scanner.
 */
export interface AntiCheatScanReport {
  readonly passed: boolean;
  readonly veto: boolean;
  readonly totalViolations: number;
  readonly vetoViolations: number;
  readonly warningViolations: number;
  readonly violationsByCategory: Record<AntiCheatCategory, number>;
  readonly scannedFiles: readonly string[];
  readonly violations: readonly AntiCheatViolation[];
  readonly summary: string;
  readonly durationMs: number;
}

/**
 * Configuration options for initializing Gate3AntiCheatScanner.
 */
export interface AntiCheatScannerOptions {
  readonly workspaceRoot?: string;
  readonly repoRoot?: string;
  readonly rules?: readonly AntiCheatRule[];
  readonly disabledRuleIds?: readonly string[];
  readonly excessiveMockThreshold?: number;
  readonly minMocksForExcessive?: number;
  readonly ignorePatterns?: readonly (RegExp | string)[];
  readonly customRules?: readonly AntiCheatRule[];
}

// ============================================================================
// FILE CLASSIFICATION & DIFF UTILITIES
// ============================================================================

/**
 * Determines whether a file path points to a test file or test suite.
 */
export function isTestFile(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = normalize(filePath).replace(/\\/g, "/");
  return GATE3_SCANNER_CONSTANTS.TEST_PATH_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

/**
 * Determines whether a file path points to application production source code.
 */
export function isProductionFile(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = normalize(filePath).replace(/\\/g, "/");
  if (isTestFile(normalized)) {
    return false;
  }
  return GATE3_SCANNER_CONSTANTS.PRODUCTION_PATH_PREFIXES.some(
    (prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`)
  );
}

/**
 * Structured hunk diff file item.
 */
export interface DiffFileSection {
  readonly filePath: string;
  readonly addedLines: readonly { line: string; lineNumber: number }[];
  readonly fullAddedContent: string;
}

/**
 * Parses unified diff into structured per-file sections with accurate line numbers.
 */
export function parseUnifiedDiff(diff: string): DiffFileSection[] {
  if (!diff || typeof diff !== "string") {
    return [];
  }

  const sections: DiffFileSection[] = [];
  const lines = diff.split("\n");
  let currentFile: string | undefined;
  let currentAddedLines: { line: string; lineNumber: number }[] = [];
  let currentLineNumber = 1;

  for (const rawLine of lines) {
    if (rawLine.startsWith("+++ b/")) {
      if (currentFile && currentAddedLines.length > GATE3_SCANNER_CONSTANTS.NUM_ZERO) {
        sections.push({
          filePath: currentFile,
          addedLines: currentAddedLines,
          fullAddedContent: currentAddedLines.map((item) => item.line).join("\n"),
        });
      }
      currentFile = rawLine.slice(GATE3_SCANNER_CONSTANTS.DIFF_HEADER_PREFIX_LENGTH).trim();
      currentAddedLines = [];
      currentLineNumber = 1;
      continue;
    }

    if (rawLine.startsWith(GATE3_SCANNER_CONSTANTS.DIFF_HUNK_PREFIX)) {
      // e.g. @@ -10,4 +15,6 @@
      const match = rawLine.match(/@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match && match[1]) {
        currentLineNumber = parseInt(match[1], 10);
      }
      continue;
    }

    if (rawLine.startsWith(GATE3_SCANNER_CONSTANTS.DIFF_PLUS_PREFIX) && !rawLine.startsWith("+++")) {
      const addedText = rawLine.slice(GATE3_SCANNER_CONSTANTS.SLICE_ONE);
      currentAddedLines.push({
        line: addedText,
        lineNumber: currentLineNumber,
      });
      currentLineNumber += GATE3_SCANNER_CONSTANTS.NUM_ONE;
    } else if (!rawLine.startsWith(GATE3_SCANNER_CONSTANTS.DIFF_MINUS_PREFIX)) {
      // Context lines advance the new file line counter
      currentLineNumber += GATE3_SCANNER_CONSTANTS.NUM_ONE;
    }
  }

  if (currentFile && currentAddedLines.length > GATE3_SCANNER_CONSTANTS.NUM_ZERO) {
    sections.push({
      filePath: currentFile,
      addedLines: currentAddedLines,
      fullAddedContent: currentAddedLines.map((item) => item.line).join("\n"),
    });
  }

  return sections;
}

// ============================================================================
// BUILT-IN ANTI-CHEAT RULES
// ============================================================================

/**
 * AC-001: Detects placeholder TODOs/FIXMEs in production files.
 */
export const rulePlaceholderTodo: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_TODO,
  name: "Placeholder TODO in Production Code",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects incomplete TODO/FIXME placeholder comments in production code.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
  appliesTo: "production",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.PLACEHOLDER_TODO.test(item.line)) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_TODO,
          ruleName: "Placeholder TODO in Production Code",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Mock placeholder or dummy stub in production code: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
          remediation: "Implement full production functionality and remove unfinished TODO placeholders.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-002: Detects explicit placeholder comments (// placeholder, // stub, // dummy) in production code.
 */
export const rulePlaceholderStub: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_STUB,
  name: "Placeholder Stub Comment in Production Code",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects explicit stub, dummy, or placeholder comments in production code.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
  appliesTo: "production",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      // If line is already a dummy return stub, ruleDummyReturnProd takes precedence
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.DUMMY_RETURN_STUB.test(item.line)) {
        continue;
      }

      if (
        GATE3_SCANNER_CONSTANTS.PATTERNS.PLACEHOLDER_STUB.test(item.line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.PLACEHOLDER_BLOCK_COMMENT.test(item.line)
      ) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_STUB,
          ruleName: "Placeholder Stub Comment in Production Code",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Mock placeholder or dummy stub in production code: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
          remediation: "Remove temporary stub or dummy comments and provide authentic logic.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-003: Detects unimplemented error throws in production code.
 */
export const rulePlaceholderUnimplemented: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_UNIMPLEMENTED,
  name: "Unimplemented Exception in Production Code",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects 'not implemented' or 'unimplemented' exceptions thrown as stubs in production files.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
  appliesTo: "production",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.UNIMPLEMENTED_ERROR.test(item.line)) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_PLACEHOLDER_UNIMPLEMENTED,
          ruleName: "Unimplemented Exception in Production Code",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Mock placeholder or dummy stub in production code: Unimplemented exception '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
          remediation: "Implement actual logic instead of throwing placeholder NotImplementedError.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-004: Detects dummy stub return statements in production code.
 */
export const ruleDummyReturnProd: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_DUMMY_RETURN_PROD,
  name: "Dummy Stub Return in Production Code",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects dummy returns (`return null as any; // stub` or empty stubs) in production code.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
  appliesTo: "production",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (
        GATE3_SCANNER_CONSTANTS.PATTERNS.DUMMY_RETURN_STUB.test(item.line) ||
        (GATE3_SCANNER_CONSTANTS.PATTERNS.DUMMY_RETURN_ANY.test(item.line) &&
          !item.line.includes("test"))
      ) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_DUMMY_RETURN_PROD,
          ruleName: "Dummy Stub Return in Production Code",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Mock placeholder or dummy stub in production code: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
          remediation: "Provide authentic computation rather than returning dummy or stubbed values.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-005: Detects testing framework mock utilities imported or invoked in production code.
 */
export const ruleMockInProduction: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_MOCK_IN_PRODUCTION,
  name: "Mock Utilities in Production Code",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects testing mock libraries (bun:test, jest, vitest) imported or invoked in production code.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
  appliesTo: "production",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (
        GATE3_SCANNER_CONSTANTS.PATTERNS.MOCK_IMPORTS_PROD.test(item.line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.MOCK_CALLS_PROD.test(item.line)
      ) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_MOCK_IN_PRODUCTION,
          ruleName: "Mock Utilities in Production Code",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Mock placeholder or dummy stub in production code: Test mock utility used in production file '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
          remediation: "Remove mock utilities from production code; reserve mocking strictly for test suites.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-006: Detects facade comments or fake constant implementations in production files.
 */
export const ruleHardcodedFacade: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_HARDCODED_FACADE,
  name: "Hardcoded Facade in Production Code",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects facade comments or hardcoded dummy facades in production logic.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
  appliesTo: "production",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.FACADE_COMMENT.test(item.line)) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_HARDCODED_FACADE,
          ruleName: "Hardcoded Facade in Production Code",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Mock placeholder or dummy stub in production code: Facade or fake implementation comment detected: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_MOCK_PROD,
          remediation: "Implement authentic business logic instead of dummy facade placeholders.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-010: Detects skipped test suites or cases (.skip, xit, xtest, xdescribe) in test files.
 */
export const ruleDisabledTestSkip: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_SKIP,
  name: "Disabled or Skipped Test Suite",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects skipped test suites or test cases (.skip, xit, xtest, xdescribe).",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (
        GATE3_SCANNER_CONSTANTS.PATTERNS.TEST_SKIP.test(item.line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.TEST_X_PREFIX.test(item.line)
      ) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_SKIP,
          ruleName: "Disabled or Skipped Test Suite",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Disabled or skipped test suite detected: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
          remediation: "Enable all test suites and fix underlying failures; test skipping is strictly prohibited.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-011: Detects todo test placeholders (.todo) in test files.
 */
export const ruleDisabledTestTodo: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_TODO,
  name: "Disabled Test Todo Placeholder",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects .todo placeholder test declarations in test files.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.TEST_TODO.test(item.line)) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_DISABLED_TEST_TODO,
          ruleName: "Disabled Test Todo Placeholder",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Disabled or skipped test suite detected: Todo test placeholder '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
          remediation: "Implement full test assertions instead of leaving .todo placeholders.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-012: Detects isolated or focused tests (.only, fit, fdescribe) which bypass the rest of the suite.
 */
export const ruleIsolatedTestOnly: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_ISOLATED_TEST_ONLY,
  name: "Isolated Test Only Evasion",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects focused or isolated test declarations (.only, fit, fdescribe) that skip remaining tests.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (
        GATE3_SCANNER_CONSTANTS.PATTERNS.TEST_ONLY.test(item.line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.TEST_F_PREFIX.test(item.line)
      ) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_ISOLATED_TEST_ONLY,
          ruleName: "Isolated Test Only Evasion",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Disabled or skipped test suite detected: Isolated test.only focuses execution, bypassing other tests: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
          remediation: "Remove .only / fit focus qualifiers to ensure entire test suite executes unconditionally.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-013: Detects commented-out assertions in test files.
 */
export const ruleCommentedAssertion: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_COMMENTED_ASSERTION,
  name: "Commented-out Assertion in Test File",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects commented-out assertion statements (// expect(...)) in test files.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (
        GATE3_SCANNER_CONSTANTS.PATTERNS.COMMENTED_ASSERTION.test(item.line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.COMMENTED_ASSERTION_BLOCK.test(item.line)
      ) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_COMMENTED_ASSERTION,
          ruleName: "Commented-out Assertion in Test File",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Disabled or skipped test suite detected: Commented-out assertion statement: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
          remediation: "Uncomment required assertions or remove obsolete test code cleanly.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-014: Detects trivial, tautological assertions (self-attestation / auto-certification).
 */
export const ruleTrivialAssertion: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_TRIVIAL_ASSERTION,
  name: "Trivial or Self-Attesting Assertion",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects trivial tautological assertions (e.g. expect(true).toBe(true), expect(x).toBe(x)).",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      const line = item.line;
      if (
        GATE3_SCANNER_CONSTANTS.PATTERNS.TRIVIAL_SAME_LITERAL.test(line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.TRIVIAL_STRING_LITERAL.test(line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.TRIVIAL_IDENTIFIER_MATCH.test(line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.TRIVIAL_BOOLEAN_HELPER.test(line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.TRIVIAL_NULL_HELPER.test(line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.TRIVIAL_ASSERT_CALL.test(line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.TRIVIAL_ARITHMETIC_TAUTOLOGY.test(line)
      ) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_TRIVIAL_ASSERTION,
          ruleName: "Trivial or Self-Attesting Assertion",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Trivial or self-attesting assertion detected: '${line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE,
          remediation: "Replace trivial auto-certifying assertions with rigorous checks against production outcomes.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-015: Detects empty test bodies with zero assertions.
 */
export const ruleEmptyTestBody: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_EMPTY_TEST_BODY,
  name: "Empty Test Body Without Assertions",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects empty test cases (test('...', () => {})) lacking empirical verification.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.EMPTY_TEST_BODY.test(item.line)) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_EMPTY_TEST_BODY,
          ruleName: "Empty Test Body Without Assertions",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Disabled or skipped test suite detected: Empty test case without assertions '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
          remediation: "Add meaningful assertions validating empirical system behavior.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-016: Detects assertion suppression via empty try-catch blocks.
 */
export const ruleAssertionSuppression: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_ASSERTION_SUPPRESSION,
  name: "Assertion Suppression in Test File",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects test assertion failures suppressed or swallowed by silent try-catch blocks.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.ASSERTION_SUPPRESSION.test(item.line)) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_ASSERTION_SUPPRESSION,
          ruleName: "Assertion Suppression in Test File",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Disabled or skipped test suite detected: Assertion wrapped in silent catch block: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_OPENSPEC_TEST_HYGIENE,
          remediation: "Allow test assertions to throw legitimately on failure without swallowing errors.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-020: Detects mocking the primary subject-under-test (SUT) inside its own unit test.
 */
export const ruleMockedSubjectUnderTest: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_MOCKED_SUBJECT_UNDER_TEST,
  name: "Mocking Subject Under Test",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects test files that mock the primary module or class they are responsible for verifying.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    // Infer primary unit under test from test file basename (e.g. gate3_audit.test.ts -> gate3_audit)
    const testFileName = basename(context.filePath);
    const primaryUnit = testFileName.replace(/\.(?:test|spec)\.[a-zA-Z0-9]+$/i, "");

    if (!primaryUnit) return violations;

    const mockSubjectRegex = new RegExp(
      `\\b(?:mock\\.module|jest\\.mock|spyOn)\\s*\\(\\s*["'\`][^"'\`]*${primaryUnit}["'\`]`,
      "i"
    );

    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (mockSubjectRegex.test(item.line)) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_MOCKED_SUBJECT_UNDER_TEST,
          ruleName: "Mocking Subject Under Test",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Mocked test suite detected: Unit under test '${primaryUnit}' is mocked out in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE,
          remediation: "Do not mock the subject under test; execute authentic code paths.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-021: Detects test harness or global runner monkey-patching.
 */
export const ruleTestHarnessHijacking: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_TEST_HARNESS_HIJACKING,
  name: "Test Harness Hijacking",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
  description: "Detects monkey-patching of test runner globals (expect, test, process.exit).",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE,
  appliesTo: "all",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    const targetLines = context.diffMode && context.addedLines
      ? context.addedLines
      : context.lines.map((line, idx) => ({ line, lineNumber: idx + 1 }));

    for (const item of targetLines) {
      if (
        GATE3_SCANNER_CONSTANTS.PATTERNS.HARNESS_HIJACKING_EXPECT.test(item.line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.HARNESS_HIJACKING_TEST.test(item.line) ||
        GATE3_SCANNER_CONSTANTS.PATTERNS.PROCESS_EXIT_HIJACKING.test(item.line)
      ) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_TEST_HARNESS_HIJACKING,
          ruleName: "Test Harness Hijacking",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_VETO,
          description: `Mocked test suite detected: Test runner harness global is hijacked: '${item.line.trim()}' in ${context.filePath}`,
          file: context.filePath,
          line: item.lineNumber,
          snippet: item.line.trim().slice(0, GATE3_SCANNER_CONSTANTS.MAX_SNIPPET_LENGTH),
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE,
          remediation: "Do not modify global test functions or process.exit in tests.",
        });
      }
    }
    return violations;
  },
};

/**
 * AC-022: Detects excessive mocking in test files where mock calls dominate assertions.
 */
export const ruleExcessiveMocking: AntiCheatRule = {
  id: GATE3_SCANNER_CONSTANTS.RULE_EXCESSIVE_MOCKING,
  name: "Excessive Mocking in Test Suite",
  category: GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES,
  severity: GATE3_SCANNER_CONSTANTS.SEVERITY_WARNING,
  description: "Detects test suites where mock statements overwhelmingly outnumber genuine assertions.",
  ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE,
  appliesTo: "test",
  evaluate(context) {
    const violations: AntiCheatViolation[] = [];
    let mockCount = 0;
    let assertionCount = 0;

    for (const line of context.lines) {
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.MOCK_DEFINITION.test(line)) {
        mockCount++;
      }
      if (GATE3_SCANNER_CONSTANTS.PATTERNS.REAL_ASSERTION.test(line)) {
        assertionCount++;
      }
    }

    const total = mockCount + assertionCount;
    if (
      mockCount >= GATE3_SCANNER_CONSTANTS.DEFAULT_MIN_MOCKS_FOR_EXCESSIVE &&
      total > GATE3_SCANNER_CONSTANTS.NUM_ZERO
    ) {
      const mockRatio = mockCount / total;
      if (mockRatio >= GATE3_SCANNER_CONSTANTS.DEFAULT_EXCESSIVE_MOCK_THRESHOLD) {
        violations.push({
          ruleId: GATE3_SCANNER_CONSTANTS.RULE_EXCESSIVE_MOCKING,
          ruleName: "Excessive Mocking in Test Suite",
          category: GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES,
          severity: GATE3_SCANNER_CONSTANTS.SEVERITY_WARNING,
          description: `Mocked test suite detected: Excessive mocking (${mockCount} mocks vs ${assertionCount} assertions, ${Math.round(mockRatio * GATE3_SCANNER_CONSTANTS.PERCENT_MULTIPLIER)}%) in ${context.filePath}`,
          file: context.filePath,
          ruleCitation: GATE3_SCANNER_CONSTANTS.CITATION_AXIOM_ORACLE,
          remediation: "Reduce over-reliance on mocks; test real domain objects and integrations.",
        });
      }
    }

    return violations;
  },
};

/**
 * Standard registry containing all canonical built-in anti-cheat rules.
 */
export const DEFAULT_ANTI_CHEAT_RULES: readonly AntiCheatRule[] = [
  rulePlaceholderTodo,
  rulePlaceholderStub,
  rulePlaceholderUnimplemented,
  ruleDummyReturnProd,
  ruleMockInProduction,
  ruleHardcodedFacade,
  ruleDisabledTestSkip,
  ruleDisabledTestTodo,
  ruleIsolatedTestOnly,
  ruleCommentedAssertion,
  ruleTrivialAssertion,
  ruleEmptyTestBody,
  ruleAssertionSuppression,
  ruleMockedSubjectUnderTest,
  ruleTestHarnessHijacking,
  ruleExcessiveMocking,
];

// ============================================================================
// ANTI-CHEAT SCANNER CLASS
// ============================================================================

/**
 * Gate3AntiCheatScanner: High-performance forensic anti-cheat detector.
 */
export class Gate3AntiCheatScanner {
  private readonly rules: Map<string, AntiCheatRule> = new Map();
  private readonly ignorePatterns: readonly (RegExp | string)[];
  private readonly workspaceRoot: string;
  private readonly repoRoot: string;

  public constructor(options: AntiCheatScannerOptions = {}) {
    this.workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
    this.repoRoot = normalize(options.repoRoot ?? this.workspaceRoot);
    this.ignorePatterns = options.ignorePatterns ?? [];

    const baseRules = options.rules ?? DEFAULT_ANTI_CHEAT_RULES;
    const disabledSet = new Set(options.disabledRuleIds ?? []);

    for (const rule of baseRules) {
      if (!disabledSet.has(rule.id)) {
        this.rules.set(rule.id, rule);
      }
    }

    if (options.customRules) {
      for (const customRule of options.customRules) {
        if (!disabledSet.has(customRule.id)) {
          this.rules.set(customRule.id, customRule);
        }
      }
    }
  }

  /**
   * Registers a new custom anti-cheat rule.
   */
  public registerRule(rule: AntiCheatRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Unregisters an anti-cheat rule by its ID.
   */
  public unregisterRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Returns all active registered anti-cheat rules.
   */
  public getRules(): readonly AntiCheatRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Checks whether a file path matches configured ignore patterns.
   */
  public isIgnored(filePath: string): boolean {
    const normalized = normalize(filePath).replace(/\\/g, "/");
    for (const pattern of this.ignorePatterns) {
      if (typeof pattern === "string") {
        if (normalized.includes(pattern)) return true;
      } else if (pattern.test(normalized)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Evaluates registered rules against a file or section context.
   */
  private async evaluateRules(
    context: AntiCheatRuleContext
  ): Promise<AntiCheatViolation[]> {
    if (this.isIgnored(context.filePath)) {
      return [];
    }

    const violations: AntiCheatViolation[] = [];

    for (const rule of this.rules.values()) {
      if (rule.appliesTo === "production" && !context.isProduction) {
        continue;
      }
      if (rule.appliesTo === "test" && !context.isTest) {
        continue;
      }

      const results = await rule.evaluate(context);
      if (results && results.length > GATE3_SCANNER_CONSTANTS.NUM_ZERO) {
        violations.push(...results);
      }
    }

    return violations;
  }

  /**
   * Scans arbitrary file content string in-memory.
   */
  public async scanContent(
    content: string,
    filePath: string = "unnamed.ts"
  ): Promise<AntiCheatScanReport> {
    const startTime = performance.now();
    const lines = content.split("\n");
    const isProd = isProductionFile(filePath);
    const isTest = isTestFile(filePath);

    const context: AntiCheatRuleContext = {
      filePath,
      isProduction: isProd,
      isTest,
      content,
      lines,
      diffMode: false,
    };

    const violations = await this.evaluateRules(context);
    return this.buildReport([filePath], violations, startTime);
  }

  /**
   * Scans a unified git diff string.
   */
  public async scanDiff(diff: string): Promise<AntiCheatScanReport> {
    const startTime = performance.now();
    const sections = parseUnifiedDiff(diff);
    const allViolations: AntiCheatViolation[] = [];
    const scannedFiles: string[] = [];

    for (const section of sections) {
      if (this.isIgnored(section.filePath)) {
        continue;
      }

      scannedFiles.push(section.filePath);
      const isProd = isProductionFile(section.filePath);
      const isTest = isTestFile(section.filePath);
      const lines = section.fullAddedContent.split("\n");

      const context: AntiCheatRuleContext = {
        filePath: section.filePath,
        isProduction: isProd,
        isTest,
        content: section.fullAddedContent,
        lines,
        addedLines: section.addedLines,
        diffMode: true,
      };

      const fileViolations = await this.evaluateRules(context);
      allViolations.push(...fileViolations);
    }

    return this.buildReport(scannedFiles, allViolations, startTime);
  }

  /**
   * Scans a single file on disk.
   */
  public async scanFile(filePath: string): Promise<AntiCheatScanReport> {
    const startTime = performance.now();
    const resolvedPath = isAbsolute(filePath)
      ? filePath
      : resolve(this.repoRoot, filePath);
    const relPath = relative(this.repoRoot, resolvedPath);

    if (this.isIgnored(relPath)) {
      return this.buildReport([relPath], [], startTime);
    }

    try {
      const content = await readFile(resolvedPath, "utf-8");
      return this.scanContent(content, relPath);
    } catch {
      return this.buildReport([relPath], [], startTime);
    }
  }

  /**
   * Scans multiple files on disk.
   */
  public async scanFiles(filePaths: readonly string[]): Promise<AntiCheatScanReport> {
    const startTime = performance.now();
    const allViolations: AntiCheatViolation[] = [];
    const scanned: string[] = [];

    for (const file of filePaths) {
      const report = await this.scanFile(file);
      scanned.push(...report.scannedFiles);
      allViolations.push(...report.violations);
    }

    return this.buildReport(scanned, allViolations, startTime);
  }

  /**
   * Scans execution context (diff and/or target files) and returns a Gate3InvariantCheckResult.
   */
  public async scanExecutionContext(
    context: Gate3ExecutionContext
  ): Promise<Gate3InvariantCheckResult> {
    const startTime = performance.now();
    let report: AntiCheatScanReport;

    if (context.gitDiff) {
      report = await this.scanDiff(context.gitDiff);
    } else if (context.targetFiles && context.targetFiles.length > GATE3_SCANNER_CONSTANTS.NUM_ZERO) {
      report = await this.scanFiles(context.targetFiles);
    } else {
      report = this.buildReport([], [], startTime);
    }

    return toGate3InvariantCheckResult(report);
  }

  /**
   * Compiles findings into an AntiCheatScanReport.
   */
  private buildReport(
    scannedFiles: readonly string[],
    violations: readonly AntiCheatViolation[],
    startTime: number
  ): AntiCheatScanReport {
    const durationMs = Math.round(performance.now() - startTime);
    const vetoViolations = violations.filter(
      (v) => v.severity === GATE3_SCANNER_CONSTANTS.SEVERITY_VETO
    ).length;
    const warningViolations = violations.filter(
      (v) => v.severity === GATE3_SCANNER_CONSTANTS.SEVERITY_WARNING
    ).length;

    const violationsByCategory: Record<AntiCheatCategory, number> = {
      [GATE3_SCANNER_CONSTANTS.CATEGORY_PLACEHOLDERS]: 0,
      [GATE3_SCANNER_CONSTANTS.CATEGORY_DISABLED_ASSERTIONS]: 0,
      [GATE3_SCANNER_CONSTANTS.CATEGORY_MOCKED_SUITES]: 0,
      [GATE3_SCANNER_CONSTANTS.CATEGORY_CUSTOM]: 0,
    };

    for (const v of violations) {
      if (v.category in violationsByCategory) {
        violationsByCategory[v.category]++;
      }
    }

    const passed = vetoViolations === GATE3_SCANNER_CONSTANTS.NUM_ZERO;
    const veto = !passed;

    let summary: string;
    if (passed) {
      summary = `Anti-cheat integrity invariant passed across ${scannedFiles.length} file(s). No stubs, skipped tests, or production mocks detected.`;
    } else {
      summary = `Anti-cheat integrity invariant violated: ${vetoViolations} veto-level violation(s) identified across ${scannedFiles.length} file(s).`;
    }

    return {
      passed,
      veto,
      totalViolations: violations.length,
      vetoViolations,
      warningViolations,
      violationsByCategory,
      scannedFiles,
      violations,
      summary,
      durationMs,
    };
  }
}

// ============================================================================
// CONVERTERS & FORMATTERS
// ============================================================================

/**
 * Converts an AntiCheatScanReport into Gate 3's canonical Gate3InvariantCheckResult.
 */
export function toGate3InvariantCheckResult(
  report: AntiCheatScanReport
): Gate3InvariantCheckResult {
  const gate3Violations: Gate3Violation[] = report.violations.map((v) => ({
    invariantName: GATE3_SCANNER_CONSTANTS.INVARIANT_NAME,
    category: GATE3_SCANNER_CONSTANTS.INVARIANT_CATEGORY,
    description: v.description,
    file: v.file,
    rule: v.ruleCitation,
  }));

  return {
    name: GATE3_SCANNER_CONSTANTS.INVARIANT_NAME,
    category: GATE3_SCANNER_CONSTANTS.INVARIANT_CATEGORY,
    status: report.passed
      ? GATE3_SCANNER_CONSTANTS.STATUS_PASSED
      : GATE3_SCANNER_CONSTANTS.STATUS_VIOLATED,
    passed: report.passed,
    details: report.summary,
    violations: gate3Violations,
    durationMs: report.durationMs,
    remediation: report.passed
      ? undefined
      : "Remove dummy stub responses, enable all tests, and replace auto-certifying assertions.",
  };
}

/**
 * Formats structured Markdown report from an AntiCheatScanReport.
 */
export function formatAntiCheatReportMarkdown(report: AntiCheatScanReport): string {
  const lines: string[] = [];
  lines.push("# Gate 3 Anti-Cheat Forensic Report");
  lines.push("");
  lines.push(`**Verdict**: ${report.passed ? "✅ PASS" : "⛔ VETO"}`);
  lines.push(`**Summary**: ${report.summary}`);
  lines.push(
    `**Metrics**: Scanned ${report.scannedFiles.length} files | ${report.totalViolations} violations (${report.vetoViolations} veto, ${report.warningViolations} warnings) in ${report.durationMs}ms`
  );
  lines.push("");

  lines.push("## Violations Breakdown by Category");
  lines.push("");
  lines.push(`- **Placeholders & Dummy Stubs**: ${report.violationsByCategory.placeholders}`);
  lines.push(`- **Disabled Assertions & Evasion**: ${report.violationsByCategory.disabled_assertions}`);
  lines.push(`- **Mocked Test Suites & Hijacking**: ${report.violationsByCategory.mocked_test_suites}`);
  if (report.violationsByCategory.custom > GATE3_SCANNER_CONSTANTS.NUM_ZERO) {
    lines.push(`- **Custom Anti-Cheat Rules**: ${report.violationsByCategory.custom}`);
  }
  lines.push("");

  if (report.violations.length > GATE3_SCANNER_CONSTANTS.NUM_ZERO) {
    lines.push("## Detected Violations");
    lines.push("");
    for (const v of report.violations.slice(0, GATE3_SCANNER_CONSTANTS.MAX_DISPLAY_VIOLATIONS)) {
      lines.push(`### [${v.severity.toUpperCase()}] ${v.ruleName} (\`${v.ruleId}\`)`);
      lines.push(`- **File**: \`${v.file}\`${v.line ? ` (line ${v.line})` : ""}`);
      lines.push(`- **Description**: ${v.description}`);
      if (v.snippet) {
        lines.push(`- **Snippet**: \`${v.snippet}\``);
      }
      if (v.ruleCitation) {
        lines.push(`- **Citation**: *${v.ruleCitation}*`);
      }
      if (v.remediation) {
        lines.push(`- **Remediation**: ${v.remediation}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Formats XML output from an AntiCheatScanReport.
 */
export function formatAntiCheatReportXml(report: AntiCheatScanReport): string {
  const lines: string[] = [];
  lines.push("<anti-cheat-report>");
  lines.push(`  <passed>${report.passed}</passed>`);
  lines.push(`  <veto>${report.veto}</veto>`);
  lines.push(`  <total-violations>${report.totalViolations}</total-violations>`);
  lines.push(`  <veto-violations>${report.vetoViolations}</veto-violations>`);
  lines.push(`  <warning-violations>${report.warningViolations}</warning-violations>`);
  lines.push(`  <scanned-files-count>${report.scannedFiles.length}</scanned-files-count>`);
  lines.push(`  <summary>${report.summary}</summary>`);

  if (report.violations.length > GATE3_SCANNER_CONSTANTS.NUM_ZERO) {
    lines.push("  <violations>");
    for (const v of report.violations) {
      lines.push("    <violation>");
      lines.push(`      <rule-id>${v.ruleId}</rule-id>`);
      lines.push(`      <rule-name>${v.ruleName}</rule-name>`);
      lines.push(`      <category>${v.category}</category>`);
      lines.push(`      <severity>${v.severity}</severity>`);
      lines.push(`      <file>${v.file}</file>`);
      if (v.line) {
        lines.push(`      <line>${v.line}</line>`);
      }
      lines.push(`      <description>${v.description}</description>`);
      lines.push("    </violation>");
    }
    lines.push("  </violations>");
  }

  lines.push("</anti-cheat-report>");
  return lines.join("\n");
}

// ============================================================================
// CONVENIENCE FACTORIES & HELPER FUNCTIONS
// ============================================================================

/**
 * Creates and initializes an AntiCheatScanner instance.
 */
export function createGate3AntiCheatScanner(
  options: AntiCheatScannerOptions = {}
): Gate3AntiCheatScanner {
  return new Gate3AntiCheatScanner(options);
}

/**
 * Convenience function running anti-cheat scan on a diff string.
 */
export async function scanAntiCheatDiff(
  diff: string,
  options?: AntiCheatScannerOptions
): Promise<AntiCheatScanReport> {
  const scanner = createGate3AntiCheatScanner(options);
  return scanner.scanDiff(diff);
}

/**
 * Convenience function running anti-cheat scan on file contents.
 */
export async function scanAntiCheatContent(
  content: string,
  filePath?: string,
  options?: AntiCheatScannerOptions
): Promise<AntiCheatScanReport> {
  const scanner = createGate3AntiCheatScanner(options);
  return scanner.scanContent(content, filePath);
}
