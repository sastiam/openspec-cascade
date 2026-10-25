/**
 * Structured compiler error and stack trace parser formatting XML feedback for Gate 0.
 *
 * Implements OpenSpec change `looper-gate0-mechanical-qa` Task 1.2 and
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.2.
 *
 * Sanitizes ANSI escape codes, extracts structured diagnostics from TypeScript compiler (tsc),
 * linters (ESLint, Biome), and test runners (bun test, jest), parses stack frames,
 * and formats machine-readable XML feedback blocks (<verification-feedback>).
 */

import type { Gate0CheckExecutionResult, Gate0FeedbackOptions, Gate0Result } from "./gate0_qa";

/**
 * Central constants ensuring zero magic numbers across Gate 0 trace parsing and XML formatting.
 */
export const GATE0_PARSER_CONSTANTS = {
  // Limits
  DEFAULT_MAX_DIAGNOSTICS: 20,
  DEFAULT_MAX_TEST_FAILURES: 15,
  DEFAULT_MAX_STACK_FRAMES: 10,
  DEFAULT_TAIL_LINES: 25,
  DEFAULT_FEEDBACK_TRUNCATION_LIMIT: 2500,
  DEFAULT_MAX_ERROR_MESSAGE_LENGTH: 500,
  DEFAULT_MAX_RAW_SNIPPET_LINES: 5,

  // Radix for integer conversions
  RADIX_DECIMAL: 10,

  // Severities
  SEVERITY_ERROR: "error" as const,
  SEVERITY_WARNING: "warning" as const,
  SEVERITY_INFO: "info" as const,

  // Diagnostic Sources
  SOURCE_TSC: "tsc" as const,
  SOURCE_ESLINT: "eslint" as const,
  SOURCE_BIOME: "biome" as const,
  SOURCE_COMPILER: "compiler" as const,
  SOURCE_LINTER: "linter" as const,
  SOURCE_GENERIC: "generic" as const,

  // Capture group indexes for TypeScript flex regex:
  // [full, file, line, col, severity, code, message]
  TSC_INDEX_FILE: 1,
  TSC_INDEX_LINE: 2,
  TSC_INDEX_COL: 3,
  TSC_INDEX_SEVERITY: 4,
  TSC_INDEX_CODE: 5,
  TSC_INDEX_MESSAGE: 6,

  // Capture group indexes for ESLint stylish regex:
  // [full, line, col, severity, message, rule]
  ESLINT_STYLISH_INDEX_LINE: 1,
  ESLINT_STYLISH_INDEX_COL: 2,
  ESLINT_STYLISH_INDEX_SEVERITY: 3,
  ESLINT_STYLISH_INDEX_MESSAGE: 4,
  ESLINT_STYLISH_INDEX_RULE: 5,

  // Capture group indexes for ESLint compact regex:
  // [full, file, line, col, severity, message, bracketRule, parenRule]
  ESLINT_COMPACT_INDEX_FILE: 1,
  ESLINT_COMPACT_INDEX_LINE: 2,
  ESLINT_COMPACT_INDEX_COL: 3,
  ESLINT_COMPACT_INDEX_SEVERITY: 4,
  ESLINT_COMPACT_INDEX_MESSAGE: 5,
  ESLINT_COMPACT_INDEX_RULE_BRACKET: 6,
  ESLINT_COMPACT_INDEX_RULE_PAREN: 7,

  // Capture group indexes for Biome error regex:
  // [full, file, line, col, rule]
  BIOME_INDEX_FILE: 1,
  BIOME_INDEX_LINE: 2,
  BIOME_INDEX_COL: 3,
  BIOME_INDEX_RULE: 4,

  // Capture group indexes for Stack Frame (named):
  // [full, func, file, line, col]
  FRAME_NAMED_INDEX_FUNC: 1,
  FRAME_NAMED_INDEX_FILE: 2,
  FRAME_NAMED_INDEX_LINE: 3,
  FRAME_NAMED_INDEX_COL: 4,

  // Capture group indexes for Stack Frame (anonymous):
  // [full, file, line, col]
  FRAME_ANON_INDEX_FILE: 1,
  FRAME_ANON_INDEX_LINE: 2,
  FRAME_ANON_INDEX_COL: 3,

  // Capture group indexes for Bun test failure header:
  // [full, file, suiteAndName]
  BUN_FAIL_HEADER_INDEX_FILE: 1,
  BUN_FAIL_HEADER_INDEX_NAME: 2,

  // Capture group indexes for Expected / Received:
  EXPECTED_INDEX_VALUE: 1,
  RECEIVED_INDEX_VALUE: 1,
} as const;

/**
 * Diagnostic severity level for compiler and linter findings.
 */
export type Gate0DiagnosticSeverity =
  | typeof GATE0_PARSER_CONSTANTS.SEVERITY_ERROR
  | typeof GATE0_PARSER_CONSTANTS.SEVERITY_WARNING
  | typeof GATE0_PARSER_CONSTANTS.SEVERITY_INFO;

/**
 * Origin source identifying which tool produced a diagnostic.
 */
export type Gate0DiagnosticSource =
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_TSC
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_ESLINT
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_BIOME
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_COMPILER
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_LINTER
  | typeof GATE0_PARSER_CONSTANTS.SOURCE_GENERIC;

/**
 * Structured compiler or linter diagnostic.
 */
export interface Gate0ParsedDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  severity: Gate0DiagnosticSeverity;
  source: Gate0DiagnosticSource;
  raw?: string;
}

/**
 * Structured stack trace frame.
 */
export interface Gate0StackFrame {
  raw: string;
  functionName?: string;
  file?: string;
  line?: number;
  column?: number;
  isInternal: boolean;
  isProject: boolean;
}

/**
 * Structured unit test failure report.
 */
export interface Gate0ParsedTestFailure {
  testName?: string;
  file?: string;
  line?: number;
  expected?: string;
  received?: string;
  message: string;
  stackFrames: Gate0StackFrame[];
  rawSnippet?: string;
}

/**
 * Complete parsed trace bundle for a failed Gate 0 check.
 */
export interface Gate0ParsedTrace {
  diagnostics: Gate0ParsedDiagnostic[];
  testFailures: Gate0ParsedTestFailure[];
  stackFrames: Gate0StackFrame[];
  sanitizedStderr: string;
  sanitizedStdout: string;
  sanitizedOutput: string;
  summaryMessage?: string;
}

/**
 * Strips ANSI escape sequences and terminal control characters from output text.
 */
export function stripAnsi(text: string): string {
  if (!text) {
    return "";
  }
  return text.replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g,
    "",
  );
}

/**
 * Escapes XML entity characters in tag content.
 */
export function escapeXml(text: string): string {
  if (!text) {
    return "";
  }
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escapes XML entity and quote characters in attribute values.
 */
export function escapeXmlAttr(text: string): string {
  if (!text) {
    return "";
  }
  return escapeXml(text)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Normalizes file paths by removing leading relative indicators.
 */
function normalizeFilePath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Parses TypeScript compiler (tsc) error outputs into structured diagnostics.
 * Handles both standard colon and parenthesized formats with multi-line detail support.
 */
export function parseTypeScriptErrors(
  rawText: string,
  maxDiagnostics: number = GATE0_PARSER_CONSTANTS.DEFAULT_MAX_DIAGNOSTICS,
): Gate0ParsedDiagnostic[] {
  const clean = stripAnsi(rawText);
  const lines = clean.split("\n");
  const diagnostics: Gate0ParsedDiagnostic[] = [];

  // Matches:
  // src/file.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.
  // src/file.ts(10,5): error TS2322: ...
  // src/file.ts:10:5: error TS2322: ...
  const tscRegex =
    /^([^\s:(]+)[:\(](\d+)[:\ ,]+(\d+)\)?(?::|\s*-)?\s*(error|warning)\s+(TS\d+):\s*(.+)$/i;

  let currentDiag: Gate0ParsedDiagnostic | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    const match = line.match(tscRegex);
    if (match) {
      if (diagnostics.length >= maxDiagnostics) {
        break;
      }

      const rawSeverity = match[GATE0_PARSER_CONSTANTS.TSC_INDEX_SEVERITY]?.toLowerCase();
      const severity: Gate0DiagnosticSeverity =
        rawSeverity === GATE0_PARSER_CONSTANTS.SEVERITY_WARNING
          ? GATE0_PARSER_CONSTANTS.SEVERITY_WARNING
          : GATE0_PARSER_CONSTANTS.SEVERITY_ERROR;

      const file = normalizeFilePath(match[GATE0_PARSER_CONSTANTS.TSC_INDEX_FILE] ?? "");
      const lineNum = parseInt(match[GATE0_PARSER_CONSTANTS.TSC_INDEX_LINE] ?? "0", GATE0_PARSER_CONSTANTS.RADIX_DECIMAL);
      const colNum = parseInt(match[GATE0_PARSER_CONSTANTS.TSC_INDEX_COL] ?? "0", GATE0_PARSER_CONSTANTS.RADIX_DECIMAL);
      const code = match[GATE0_PARSER_CONSTANTS.TSC_INDEX_CODE];
      const message = match[GATE0_PARSER_CONSTANTS.TSC_INDEX_MESSAGE]?.trim() ?? "";

      currentDiag = {
        file,
        line: lineNum,
        column: colNum,
        code,
        message,
        severity,
        source: GATE0_PARSER_CONSTANTS.SOURCE_TSC,
        raw: line,
      };

      diagnostics.push(currentDiag);
    } else if (currentDiag && (rawLine.startsWith("  ") || rawLine.startsWith("\t"))) {
      // Continuation line for error explanation (skip code snippet pointer lines)
      const trimmed = line.trim();
      const isCodePointer = /^~+|\^+|\d+\s+/.test(trimmed);
      if (!isCodePointer && trimmed.length > 0) {
        currentDiag.message += ` ${trimmed}`;
      }
    }
  }

  return diagnostics;
}

/**
 * Parses linter diagnostics from ESLint (stylish & compact formats) or Biome.
 */
export function parseLinterErrors(
  rawText: string,
  maxDiagnostics: number = GATE0_PARSER_CONSTANTS.DEFAULT_MAX_DIAGNOSTICS,
): Gate0ParsedDiagnostic[] {
  const clean = stripAnsi(rawText);
  const lines = clean.split("\n");
  const diagnostics: Gate0ParsedDiagnostic[] = [];

  // ESLint stylish: File header line followed by indented problem lines
  //   10:5  error  Unexpected any  @typescript-eslint/no-explicit-any
  const stylishProblemRegex =
    /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}([a-zA-Z0-9_\-\/@]+))?$/i;

  // Biome:
  // src/file.ts:10:5 lint/suspicious/noExplicitAny
  const biomeHeaderRegex =
    /^([^\s:]+):(\d+):(\d+)\s+([a-zA-Z0-9_\-\/]+(?:\/[a-zA-Z0-9_\-]+)?)/;

  // ESLint compact/unix:
  // src/file.ts:10:5: Unexpected any [@typescript-eslint/no-explicit-any]
  // src/file.ts: line 10, col 5, Error - Unexpected any (@typescript-eslint/no-explicit-any)
  const compactRegex =
    /^([^\s:]+):\s*(?:line\s+)?(\d+)(?:,\s*col\s*|:)(\d+)(?::|,)?\s*(?:(error|warning)(?:\s*-|:)?\s*)?(.*?)(?:\s+\[([a-zA-Z0-9_\-\/@]+)\]|\s+\(([a-zA-Z0-9_\-\/@]+)\))?$/i;

  let currentFile = "";

  for (const rawLine of lines) {
    if (diagnostics.length >= maxDiagnostics) {
      break;
    }

    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    // 1. Check stylish file header: starts at column 0, looks like file path
    const isHeaderCandidate =
      !rawLine.startsWith(" ") &&
      !rawLine.startsWith("\t") &&
      !line.startsWith("✖") &&
      (line.endsWith(".ts") ||
        line.endsWith(".tsx") ||
        line.endsWith(".js") ||
        line.endsWith(".jsx") ||
        line.endsWith(".mjs") ||
        line.endsWith(".cjs") ||
        line.includes("/") ||
        line.includes("\\"));

    if (isHeaderCandidate && !line.includes(":")) {
      currentFile = normalizeFilePath(line.trim());
      continue;
    }

    // 2. Check stylish problem line
    const stylishMatch = line.match(stylishProblemRegex);
    if (stylishMatch) {
      const lineNum = parseInt(
        stylishMatch[GATE0_PARSER_CONSTANTS.ESLINT_STYLISH_INDEX_LINE] ?? "0",
        GATE0_PARSER_CONSTANTS.RADIX_DECIMAL,
      );
      const colNum = parseInt(
        stylishMatch[GATE0_PARSER_CONSTANTS.ESLINT_STYLISH_INDEX_COL] ?? "0",
        GATE0_PARSER_CONSTANTS.RADIX_DECIMAL,
      );
      const rawSev =
        stylishMatch[GATE0_PARSER_CONSTANTS.ESLINT_STYLISH_INDEX_SEVERITY]?.toLowerCase();
      const severity: Gate0DiagnosticSeverity =
        rawSev === GATE0_PARSER_CONSTANTS.SEVERITY_WARNING
          ? GATE0_PARSER_CONSTANTS.SEVERITY_WARNING
          : GATE0_PARSER_CONSTANTS.SEVERITY_ERROR;
      const message =
        stylishMatch[GATE0_PARSER_CONSTANTS.ESLINT_STYLISH_INDEX_MESSAGE]?.trim() ?? "";
      const code = stylishMatch[GATE0_PARSER_CONSTANTS.ESLINT_STYLISH_INDEX_RULE]?.trim();

      diagnostics.push({
        file: currentFile || undefined,
        line: lineNum,
        column: colNum,
        code,
        message,
        severity,
        source: GATE0_PARSER_CONSTANTS.SOURCE_ESLINT,
        raw: line,
      });
      continue;
    }

    // 3. Check Biome format
    const biomeMatch = line.match(biomeHeaderRegex);
    if (biomeMatch && (line.includes("lint/") || line.includes("FIXABLE") || line.includes("━"))) {
      const file = normalizeFilePath(
        biomeMatch[GATE0_PARSER_CONSTANTS.BIOME_INDEX_FILE] ?? "",
      );
      const lineNum = parseInt(
        biomeMatch[GATE0_PARSER_CONSTANTS.BIOME_INDEX_LINE] ?? "0",
        GATE0_PARSER_CONSTANTS.RADIX_DECIMAL,
      );
      const colNum = parseInt(
        biomeMatch[GATE0_PARSER_CONSTANTS.BIOME_INDEX_COL] ?? "0",
        GATE0_PARSER_CONSTANTS.RADIX_DECIMAL,
      );
      const code = biomeMatch[GATE0_PARSER_CONSTANTS.BIOME_INDEX_RULE]?.trim();

      diagnostics.push({
        file,
        line: lineNum,
        column: colNum,
        code,
        message: line,
        severity: GATE0_PARSER_CONSTANTS.SEVERITY_ERROR,
        source: GATE0_PARSER_CONSTANTS.SOURCE_BIOME,
        raw: line,
      });
      continue;
    }

    // 4. Check compact/unix format
    const compactMatch = line.match(compactRegex);
    if (compactMatch) {
      const file = normalizeFilePath(
        compactMatch[GATE0_PARSER_CONSTANTS.ESLINT_COMPACT_INDEX_FILE] ?? "",
      );
      const lineNum = parseInt(
        compactMatch[GATE0_PARSER_CONSTANTS.ESLINT_COMPACT_INDEX_LINE] ?? "0",
        GATE0_PARSER_CONSTANTS.RADIX_DECIMAL,
      );
      const colNum = parseInt(
        compactMatch[GATE0_PARSER_CONSTANTS.ESLINT_COMPACT_INDEX_COL] ?? "0",
        GATE0_PARSER_CONSTANTS.RADIX_DECIMAL,
      );
      const rawSev =
        compactMatch[GATE0_PARSER_CONSTANTS.ESLINT_COMPACT_INDEX_SEVERITY]?.toLowerCase();
      const severity: Gate0DiagnosticSeverity =
        rawSev === GATE0_PARSER_CONSTANTS.SEVERITY_WARNING
          ? GATE0_PARSER_CONSTANTS.SEVERITY_WARNING
          : GATE0_PARSER_CONSTANTS.SEVERITY_ERROR;
      const message =
        compactMatch[GATE0_PARSER_CONSTANTS.ESLINT_COMPACT_INDEX_MESSAGE]?.trim() ?? "";
      const code =
        compactMatch[GATE0_PARSER_CONSTANTS.ESLINT_COMPACT_INDEX_RULE_BRACKET] ??
        compactMatch[GATE0_PARSER_CONSTANTS.ESLINT_COMPACT_INDEX_RULE_PAREN];

      diagnostics.push({
        file,
        line: lineNum,
        column: colNum,
        code,
        message,
        severity,
        source: GATE0_PARSER_CONSTANTS.SOURCE_ESLINT,
        raw: line,
      });
    }
  }

  return diagnostics;
}

/**
 * Parses raw stack trace lines into structured stack frames, identifying project vs runtime internals.
 */
export function parseStackTrace(
  rawText: string,
  maxFrames: number = GATE0_PARSER_CONSTANTS.DEFAULT_MAX_STACK_FRAMES,
): Gate0StackFrame[] {
  const clean = stripAnsi(rawText);
  const lines = clean.split("\n");
  const frames: Gate0StackFrame[] = [];

  // Named frame: at runTest (src/runner.ts:25:10)
  const namedRegex =
    /^\s*at\s+(?:async\s+)?([^\s(]+(?:\s+\[as\s+[^\]]+\])?)\s*\((?:file:\/\/)?(.+?):(\d+)(?::(\d+))?\)/;

  // Anonymous frame: at src/runner.ts:25:10
  const anonRegex =
    /^\s*at\s+(?:async\s+)?(?:file:\/\/)?(.+?):(\d+)(?::(\d+))?$/;

  for (const rawLine of lines) {
    if (frames.length >= maxFrames) {
      break;
    }

    const line = rawLine.trimEnd();
    const namedMatch = line.match(namedRegex);

    if (namedMatch) {
      const funcName = namedMatch[GATE0_PARSER_CONSTANTS.FRAME_NAMED_INDEX_FUNC];
      const filePath = namedMatch[GATE0_PARSER_CONSTANTS.FRAME_NAMED_INDEX_FILE] ?? "";
      const lineNum = parseInt(
        namedMatch[GATE0_PARSER_CONSTANTS.FRAME_NAMED_INDEX_LINE] ?? "0",
        GATE0_PARSER_CONSTANTS.RADIX_DECIMAL,
      );
      const colRaw = namedMatch[GATE0_PARSER_CONSTANTS.FRAME_NAMED_INDEX_COL];
      const colNum = colRaw ? parseInt(colRaw, GATE0_PARSER_CONSTANTS.RADIX_DECIMAL) : undefined;

      const isInternal = isInternalPath(filePath);
      const isProject = !isInternal && isProjectPath(filePath);

      frames.push({
        raw: line.trim(),
        functionName: funcName,
        file: normalizeFilePath(filePath),
        line: lineNum,
        column: colNum,
        isInternal,
        isProject,
      });
      continue;
    }

    const anonMatch = line.match(anonRegex);
    if (anonMatch) {
      const filePath = anonMatch[GATE0_PARSER_CONSTANTS.FRAME_ANON_INDEX_FILE] ?? "";
      const lineNum = parseInt(
        anonMatch[GATE0_PARSER_CONSTANTS.FRAME_ANON_INDEX_LINE] ?? "0",
        GATE0_PARSER_CONSTANTS.RADIX_DECIMAL,
      );
      const colRaw = anonMatch[GATE0_PARSER_CONSTANTS.FRAME_ANON_INDEX_COL];
      const colNum = colRaw ? parseInt(colRaw, GATE0_PARSER_CONSTANTS.RADIX_DECIMAL) : undefined;

      const isInternal = isInternalPath(filePath);
      const isProject = !isInternal && isProjectPath(filePath);

      frames.push({
        raw: line.trim(),
        file: normalizeFilePath(filePath),
        line: lineNum,
        column: colNum,
        isInternal,
        isProject,
      });
    }
  }

  return frames;
}

/**
 * Checks whether a file path belongs to runtime internals or node_modules.
 */
function isInternalPath(filePath: string): boolean {
  return (
    filePath.startsWith("node:") ||
    filePath.startsWith("bun:") ||
    filePath.includes("node_modules/") ||
    filePath.includes("/internal/") ||
    filePath.includes("(node:") ||
    filePath.includes("(bun:")
  );
}

/**
 * Checks whether a file path belongs to the application project.
 */
function isProjectPath(filePath: string): boolean {
  const norm = normalizeFilePath(filePath);
  return (
    norm.startsWith("src/") ||
    norm.startsWith("test/") ||
    norm.includes("/src/") ||
    norm.includes("/test/")
  );
}

/**
 * Parses test runner failures (Bun test, Jest, Vitest) into structured failure reports.
 */
export function parseTestFailures(
  rawText: string,
  maxFailures: number = GATE0_PARSER_CONSTANTS.DEFAULT_MAX_TEST_FAILURES,
): Gate0ParsedTestFailure[] {
  const clean = stripAnsi(rawText);
  const lines = clean.split("\n");
  const failures: Gate0ParsedTestFailure[] = [];

  // Match headers:
  // (fail) test/gates/gate0.test.ts > suite > test name [1.23ms]
  // ✗ test/gates/gate0.test.ts > suite > test name
  // ● suite › test name
  const bunFailHeaderRegex =
    /^(?:\(fail\)|✗|✕|FAIL|\*\(fail\))\s+([^\s>]+)\s*>\s*(.+?)(?:\s+\[\d+.*?\])?$/i;

  const jestFailHeaderRegex =
    /^(?:●|\*\(fail\))\s+(.+)$/;

  let currentFailure: Gate0ParsedTestFailure | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const bunMatch = line.match(bunFailHeaderRegex);
    if (bunMatch) {
      if (failures.length >= maxFailures) {
        break;
      }
      const file = normalizeFilePath(
        bunMatch[GATE0_PARSER_CONSTANTS.BUN_FAIL_HEADER_INDEX_FILE] ?? "",
      );
      const testName =
        bunMatch[GATE0_PARSER_CONSTANTS.BUN_FAIL_HEADER_INDEX_NAME]?.trim() ?? "";

      currentFailure = {
        testName,
        file,
        message: "",
        stackFrames: [],
      };
      failures.push(currentFailure);
      continue;
    }

    const jestMatch = line.match(jestFailHeaderRegex);
    if (jestMatch && !line.includes("test failed")) {
      if (failures.length >= maxFailures) {
        break;
      }
      const testName = jestMatch[1]?.trim() ?? "";
      currentFailure = {
        testName,
        message: "",
        stackFrames: [],
      };
      failures.push(currentFailure);
      continue;
    }

    // Capture expected value
    if (currentFailure && !currentFailure.expected) {
      const expMatch = line.match(/^(?:Expected|- Expected):\s*(.+)$/i);
      if (expMatch) {
        currentFailure.expected = expMatch[GATE0_PARSER_CONSTANTS.EXPECTED_INDEX_VALUE]?.trim();
        continue;
      }
    }

    // Capture received value
    if (currentFailure && !currentFailure.received) {
      const recMatch = line.match(/^(?:Received|\+ Received):\s*(.+)$/i);
      if (recMatch) {
        currentFailure.received = recMatch[GATE0_PARSER_CONSTANTS.RECEIVED_INDEX_VALUE]?.trim();
        continue;
      }
    }

    // Capture error / assertion message
    if (currentFailure && !currentFailure.message) {
      if (
        line.startsWith("error:") ||
        line.startsWith("AssertionError") ||
        line.startsWith("expect(")
      ) {
        currentFailure.message = line;
        continue;
      }
    }

    // Capture stack frames associated with failure
    if (currentFailure && line.startsWith("at ")) {
      const frames = parseStackTrace(line, 1);
      if (frames[0]) {
        currentFailure.stackFrames.push(frames[0]);
        if (!currentFailure.file && frames[0].file) {
          currentFailure.file = frames[0].file;
          currentFailure.line = frames[0].line;
        }
      }
    }
  }

  // Fallback: If no structured headers matched but "AssertionError" or "failing" is present
  if (failures.length === 0) {
    const assertionMatch = clean.match(/(?:AssertionError[^\n]*|(?:\d+\s+test\s+failed:[^\n]*))/i);
    const expectedMatch = clean.match(/Expected:\s*([^\n]+)/i);
    const receivedMatch = clean.match(/Received:\s*([^\n]+)/i);
    const stack = parseStackTrace(clean);

    if (assertionMatch || expectedMatch || stack.length > 0) {
      const firstProjectFrame = stack.find((f) => f.isProject);
      failures.push({
        testName: assertionMatch ? assertionMatch[0].trim() : "Test Failure",
        file: firstProjectFrame?.file,
        line: firstProjectFrame?.line,
        expected: expectedMatch ? expectedMatch[1]?.trim() : undefined,
        received: receivedMatch ? receivedMatch[1]?.trim() : undefined,
        message: assertionMatch ? assertionMatch[0].trim() : "Assertion error",
        stackFrames: stack,
      });
    }
  }

  return failures;
}

/**
 * Synthesizes comprehensive structured trace intelligence from raw stdout and stderr streams.
 */
export function parseGate0Trace(
  stdout: string,
  stderr: string,
  checkType?: string,
  command?: string,
): Gate0ParsedTrace {
  const cleanStdout = stripAnsi(stdout);
  const cleanStderr = stripAnsi(stderr);
  const combined = [cleanStdout, cleanStderr].filter(Boolean).join("\n");

  const normalizedType = (checkType ?? "").toLowerCase();
  const normalizedCommand = (command ?? "").toLowerCase();

  let diagnostics: Gate0ParsedDiagnostic[] = [];
  let testFailures: Gate0ParsedTestFailure[] = [];

  const isTypecheck =
    normalizedType === "typecheck" ||
    normalizedCommand.includes("tsc") ||
    combined.includes("TS");

  const isLint =
    normalizedType === "lint" ||
    normalizedCommand.includes("lint") ||
    normalizedCommand.includes("eslint") ||
    normalizedCommand.includes("biome");

  const isTest =
    normalizedType === "test" ||
    normalizedCommand.includes("test") ||
    combined.includes("(fail)") ||
    combined.includes("AssertionError");

  if (isTypecheck) {
    diagnostics = parseTypeScriptErrors(combined);
  }

  if (isLint) {
    const lintDiags = parseLinterErrors(combined);
    diagnostics = [...diagnostics, ...lintDiags];
  }

  if (isTest) {
    testFailures = parseTestFailures(combined);
  }

  // Parse general stack frames
  const stackFrames = parseStackTrace(combined);

  let summaryMessage: string | undefined;
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    summaryMessage = `Compiler diagnostic in ${first?.file ?? "unknown"}:${first?.line ?? 0} [${first?.code ?? "error"}]: ${first?.message ?? ""}`;
  } else if (testFailures.length > 0) {
    const first = testFailures[0];
    summaryMessage = `Test failure in ${first?.testName ?? "test"}: ${first?.message || first?.expected || "failed assertion"}`;
  } else if (stackFrames.length > 0) {
    const firstProj = stackFrames.find((f) => f.isProject) ?? stackFrames[0];
    summaryMessage = `Exception at ${firstProj?.file ?? "unknown"}:${firstProj?.line ?? 0}`;
  }

  return {
    diagnostics,
    testFailures,
    stackFrames,
    sanitizedStderr: cleanStderr,
    sanitizedStdout: cleanStdout,
    sanitizedOutput: combined,
    summaryMessage,
  };
}

/**
 * Formats an individual failed check result into a structured XML <failure> block.
 */
export function formatFailureXml(
  failure: Gate0CheckExecutionResult,
  options: Gate0FeedbackOptions = {},
): string {
  const maxLength = options.maxLength ?? GATE0_PARSER_CONSTANTS.DEFAULT_FEEDBACK_TRUNCATION_LIMIT;
  const tailLinesCount = options.tailLines ?? GATE0_PARSER_CONSTANTS.DEFAULT_TAIL_LINES;

  const parsed =
    failure.parsedTrace ??
    parseGate0Trace(failure.stdout, failure.stderr, failure.type, failure.command);

  const parts: string[] = [];

  parts.push(
    `<failure check_id="${escapeXmlAttr(failure.id)}" type="${escapeXmlAttr(failure.type)}" command="${escapeXmlAttr(failure.command)}" exit_code="${failure.exitCode}" timed_out="${failure.timedOut}">`,
  );

  // 1. Diagnostics (Compiler & Linter)
  if (parsed.diagnostics.length > 0) {
    parts.push(`  <diagnostics count="${parsed.diagnostics.length}">`);
    for (const diag of parsed.diagnostics) {
      const fileAttr = diag.file ? ` file="${escapeXmlAttr(diag.file)}"` : "";
      const lineAttr = diag.line !== undefined ? ` line="${diag.line}"` : "";
      const colAttr = diag.column !== undefined ? ` column="${diag.column}"` : "";
      const codeAttr = diag.code ? ` code="${escapeXmlAttr(diag.code)}"` : "";
      const sevAttr = ` severity="${escapeXmlAttr(diag.severity)}"`;
      const srcAttr = ` source="${escapeXmlAttr(diag.source)}"`;

      parts.push(
        `    <diagnostic${fileAttr}${lineAttr}${colAttr}${codeAttr}${sevAttr}${srcAttr}>`,
      );
      parts.push(`      ${escapeXml(diag.message)}`);
      parts.push("    </diagnostic>");
    }
    parts.push("  </diagnostics>");
  }

  // 2. Test Failures
  if (parsed.testFailures.length > 0) {
    parts.push(`  <test-failures count="${parsed.testFailures.length}">`);
    for (const testFail of parsed.testFailures) {
      const nameAttr = testFail.testName ? ` name="${escapeXmlAttr(testFail.testName)}"` : "";
      const fileAttr = testFail.file ? ` file="${escapeXmlAttr(testFail.file)}"` : "";
      const lineAttr = testFail.line !== undefined ? ` line="${testFail.line}"` : "";

      parts.push(`    <test-failure${nameAttr}${fileAttr}${lineAttr}>`);
      if (testFail.message) {
        parts.push(`      <message>${escapeXml(testFail.message)}</message>`);
      }
      if (testFail.expected !== undefined) {
        parts.push(`      <expected>${escapeXml(testFail.expected)}</expected>`);
      }
      if (testFail.received !== undefined) {
        parts.push(`      <received>${escapeXml(testFail.received)}</received>`);
      }

      if (testFail.stackFrames.length > 0) {
        parts.push("      <stack-trace>");
        for (const frame of testFail.stackFrames) {
          const funcAttr = frame.functionName
            ? ` func="${escapeXmlAttr(frame.functionName)}"`
            : "";
          const frameFileAttr = frame.file ? ` file="${escapeXmlAttr(frame.file)}"` : "";
          const frameLineAttr = frame.line !== undefined ? ` line="${frame.line}"` : "";
          const frameColAttr = frame.column !== undefined ? ` column="${frame.column}"` : "";
          const internalAttr = ` internal="${frame.isInternal}"`;
          parts.push(
            `        <frame${funcAttr}${frameFileAttr}${frameLineAttr}${frameColAttr}${internalAttr} />`,
          );
        }
        parts.push("      </stack-trace>");
      }
      parts.push("    </test-failure>");
    }
    parts.push("  </test-failures>");
  }

  // 3. Top-level stack frames (if no test failures captured them)
  if (parsed.testFailures.length === 0 && parsed.stackFrames.length > 0) {
    parts.push("  <stack-trace>");
    for (const frame of parsed.stackFrames) {
      const funcAttr = frame.functionName
        ? ` func="${escapeXmlAttr(frame.functionName)}"`
        : "";
      const frameFileAttr = frame.file ? ` file="${escapeXmlAttr(frame.file)}"` : "";
      const frameLineAttr = frame.line !== undefined ? ` line="${frame.line}"` : "";
      const frameColAttr = frame.column !== undefined ? ` column="${frame.column}"` : "";
      const internalAttr = ` internal="${frame.isInternal}"`;
      parts.push(
        `    <frame${funcAttr}${frameFileAttr}${frameLineAttr}${frameColAttr}${internalAttr} />`,
      );
    }
    parts.push("  </stack-trace>");
  }

  // 4. Stderr section
  if (failure.stderr.trim()) {
    parts.push("  <stderr>");
    const lines = failure.stderr.trim().split("\n");
    const tail = lines.slice(-tailLinesCount).join("\n").slice(-maxLength);
    parts.push(`    ${tail.replace(/\n/g, "\n    ")}`);
    parts.push("  </stderr>");
  }

  // 5. Stdout section
  if (failure.stdout.trim()) {
    parts.push("  <stdout>");
    const lines = failure.stdout.trim().split("\n");
    const tail = lines.slice(-tailLinesCount).join("\n").slice(-maxLength);
    parts.push(`    ${tail.replace(/\n/g, "\n    ")}`);
    parts.push("  </stdout>");
  }

  // 6. Generic output fallback
  if (!failure.stderr.trim() && !failure.stdout.trim() && failure.output.trim()) {
    parts.push("  <output>");
    const tail = failure.output.trim().slice(-maxLength);
    parts.push(`    ${tail.replace(/\n/g, "\n    ")}`);
    parts.push("  </output>");
  }

  // 7. Error message
  if (failure.errorMessage) {
    parts.push(`  <error-message>${escapeXml(failure.errorMessage)}</error-message>`);
  }

  parts.push("</failure>");
  return parts.join("\n");
}

/**
 * Formats Gate 0 check failures into structured XML blocks for worker feedback re-injection.
 */
export function formatGate0Feedback(
  result: Gate0Result,
  options: Gate0FeedbackOptions = {},
): string {
  if (result.success || result.failures.length === 0) {
    return "";
  }

  const taskId = options.taskId ? `Task ${options.taskId}` : "The task";
  const attemptInfo =
    options.attempt !== undefined && options.maxAttempts !== undefined
      ? ` (attempt ${options.attempt}/${options.maxAttempts})`
      : "";

  const failureBlocks = result.failures.map((f) => formatFailureXml(f, options));

  return [
    `${taskId} is not done; Gate 0 automated mechanical QA checks failed${attemptInfo}.`,
    "",
    '<verification-feedback gate="gate0" verdict="FAILED">',
    ...failureBlocks,
    "</verification-feedback>",
    "",
    "Analyze the failure traces, fix the underlying root causes, and re-verify before finishing the task.",
  ].join("\n");
}
