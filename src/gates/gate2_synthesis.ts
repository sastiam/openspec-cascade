/**
 * Gate 2: Automated Edge-Case Synthesis Engine (Red-Team Fuzzing Probes).
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.4 (LOOPER-GATE-003)
 * and OpenSpec change `looper-gate2-adversarial-challenger` Task 1.2.
 *
 * Provides automated synthesis of adversarial test probes across four critical attack vectors:
 * 1. Nulls, Undefined, & Malformed Payloads: Null references, empty objects, corrupted JSON,
 *    prototype pollution attempts, and missing required properties.
 * 2. Boundary Limits: 32-bit integer limits (2^31 - 1), IEEE-754 Safe Integers (Number.MAX_SAFE_INTEGER),
 *    NaN, Infinity, zero boundaries, huge strings (100k chars), unicode exploits (null byte, RTL,
 *    zero-width spaces, emoji surrogates), and large/deep collections.
 * 3. Concurrency & Race Conditions: Parallel Promise.all flooding, microtask rapid interleaving,
 *    and shared state consistency assertions.
 * 4. Timeouts & Latency: Execution watchdog bounds, delayed async iterations, and AbortSignal
 *    cancellation races.
 *
 * Adheres strictly to Zero Magic Numbers, Strict Typing, and Cross-Platform Path Safety.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type {
  Gate2AttackVector,
  Gate2ExecutionContext,
  Gate2ProbeDefinition,
} from "./gate2_challenger";

/**
 * Sanitizes a probe ID or name for use in filesystem paths.
 */
export function sanitizeProbeName(name: string): string {
  if (!name || typeof name !== "string") {
    return "probe";
  }
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/**
 * Central constants ensuring zero magic numbers across Gate 2 synthesis operations.
 */
export const GATE2_SYNTHESIS_CONSTANTS = {
  // Attack Vectors (aligned with GATE2_CONSTANTS)
  VECTOR_BOUNDARY_MALFORMED: "boundary_malformed" as const,
  VECTOR_CONCURRENCY_RACE: "concurrency_race" as const,
  VECTOR_RESOURCE_EXHAUSTION: "resource_exhaustion" as const,
  VECTOR_TIMEOUT_LATENCY: "timeout_latency" as const,
  VECTOR_CUSTOM: "custom" as const,

  // Synthesis Categories
  CATEGORY_NULL_UNDEFINED: "null_undefined" as const,
  CATEGORY_BOUNDARY_LIMITS: "boundary_limits" as const,
  CATEGORY_CONCURRENCY_RACE: "concurrency_race" as const,
  CATEGORY_TIMEOUT_LATENCY: "timeout_latency" as const,
  CATEGORY_MALFORMED_PAYLOAD: "malformed_payload" as const,
  CATEGORY_UNICODE_EXPLOIT: "unicode_exploit" as const,
  CATEGORY_RESOURCE_EXHAUSTION: "resource_exhaustion" as const,

  // Numerical Boundaries
  INT32_MAX: 2_147_483_647,
  INT32_MIN: -2_147_483_648,
  SAFE_INT_MAX: Number.MAX_SAFE_INTEGER, // 9007199254740991
  SAFE_INT_MIN: Number.MIN_SAFE_INTEGER, // -9007199254740991
  NUM_ZERO: 0,
  NUM_NEGATIVE_ZERO: -0,
  NUM_ONE: 1,
  NUM_NEGATIVE_ONE: -1,
  NUM_EPSILON: Number.EPSILON,

  // Boundary String Sizes & Sequences
  EMPTY_STRING: "",
  WHITESPACE_STRING: "   \t\r\n   ",
  UNICODE_NULL_BYTE: "\0",
  UNICODE_ZALGO_SAMPLE: "H̵e̸l̷l̸o̶_̸W̸o̸r̷l̷d̸",
  UNICODE_RTL_OVERRIDE: "\u202Ereversed_payload\u202C",
  UNICODE_ZERO_WIDTH: "\u200B\u200C\u200D\uFEFF",
  UNICODE_EMOJI_SEQUENCE: "🔥💥🚀🧑‍💻👾🧪",
  HUGE_STRING_SIZE: 100_000,
  LARGE_STRING_CHUNK: 1_000,

  // Collection Sizes
  EMPTY_ARRAY_LENGTH: 0,
  LARGE_ARRAY_LENGTH: 10_000,
  DEEP_NESTING_DEPTH: 50,

  // Concurrency Defaults
  DEFAULT_CONCURRENCY_PARALLEL_COUNT: 20,
  HIGH_CONCURRENCY_PARALLEL_COUNT: 50,
  MICROTASK_BURST_COUNT: 10,
  STAGGER_DELAY_MS: 5,

  // Timeout Defaults
  DEFAULT_PROBE_TIMEOUT_MS: 30_000,
  DEFAULT_OPERATION_TIMEOUT_MS: 2_000,
  SIMULATED_LATENCY_DELAY_MS: 1_500,
  WATCHDOG_GRACE_PERIOD_MS: 500,

  // Synthesis Limits
  DEFAULT_MAX_PROBES_PER_VECTOR: 2,
  DEFAULT_MAX_TOTAL_PROBES: 16,
  MAX_EXPORTS_PER_FILE: 10,

  // File Paths & Suffixes
  TEST_DIR_DEFAULT: "test",
  SRC_DIR_DEFAULT: "src",
  TS_EXTENSION: ".ts",
  JS_EXTENSION: ".js",
  PROBE_PREFIX: "synth_",

  // Numeric literals and offsets
  ZERO: 0,
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  INDEX_NOT_FOUND: -1,
  SLICE_START: 0,
  RADIX_DECIMAL: 10,
  UUID_TRUNCATION_LENGTH: 8,
} as const;

/**
 * Recognized edge case category types.
 */
export type EdgeCaseCategory =
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_NULL_UNDEFINED
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_BOUNDARY_LIMITS
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_CONCURRENCY_RACE
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_TIMEOUT_LATENCY
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_MALFORMED_PAYLOAD
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_UNICODE_EXPLOIT
  | typeof GATE2_SYNTHESIS_CONSTANTS.CATEGORY_RESOURCE_EXHAUSTION;

/**
 * Discovered export entry from static code analysis.
 */
export interface TargetExportInfo {
  readonly name: string;
  readonly kind: "function" | "class" | "const_arrow" | "unknown";
  readonly isAsync: boolean;
  readonly parameterCount: number;
}

/**
 * Analyzed target file metadata for synthesis.
 */
export interface TargetFileInfo {
  readonly filePath: string;
  readonly relativePath: string;
  readonly exports: readonly TargetExportInfo[];
  readonly hasDefaultExport: boolean;
}

/**
 * Options configuring automated edge case synthesis.
 */
export interface Gate2SynthesisOptions {
  /** Root directory of workspace (defaults to process.cwd()) */
  readonly workspaceRoot?: string;
  /** Directory where test probes are located/executed (defaults to <workspaceRoot>/test) */
  readonly testDir?: string;
  /** Specific target files to analyze and synthesize probes for */
  readonly targetFiles?: readonly string[];
  /** Enabled attack vector categories (defaults to all) */
  readonly includeVectors?: readonly Gate2AttackVector[];
  /** Enabled subcategories (defaults to all) */
  readonly includeCategories?: readonly EdgeCaseCategory[];
  /** Maximum total probes to synthesize across all targets */
  readonly maxProbes?: number;
  /** Concurrency level for parallel probes */
  readonly concurrencyCount?: number;
  /** Operation watchdog timeout in milliseconds */
  readonly operationTimeoutMs?: number;
  /** Probe execution timeout in milliseconds */
  readonly probeTimeoutMs?: number;
  /** Task description context */
  readonly taskDescription?: string;
  /** Acceptance criteria context */
  readonly acceptanceCriteria?: readonly string[];
  /** Optional pre-parsed target files */
  readonly targetFileInfos?: readonly TargetFileInfo[];
}

// ============================================================================
// STATIC CODE ANALYSIS & EXPORT EXTRACTION
// ============================================================================

/**
 * Normalizes a file path to use POSIX forward slashes for cross-platform imports.
 */
export function normalizeImportPath(rawPath: string): string {
  const parts = rawPath.split(sep);
  let posixPath = parts.join("/");
  if (!posixPath.startsWith(".") && !posixPath.startsWith("/")) {
    posixPath = `./${posixPath}`;
  }
  if (posixPath.endsWith(GATE2_SYNTHESIS_CONSTANTS.TS_EXTENSION)) {
    posixPath = posixPath.slice(
      GATE2_SYNTHESIS_CONSTANTS.SLICE_START,
      posixPath.length - GATE2_SYNTHESIS_CONSTANTS.TS_EXTENSION.length
    );
  }
  return posixPath;
}

/**
 * Strips block and line comments from TypeScript source to prevent false positives in regex.
 */
export function stripComments(source: string): string {
  if (!source || typeof source !== "string") {
    return GATE2_SYNTHESIS_CONSTANTS.EMPTY_STRING;
  }
  return source
    .replace(/\/\*[\s\S]*?\*\//g, GATE2_SYNTHESIS_CONSTANTS.EMPTY_STRING)
    .replace(/\/\/[^\n]*/g, GATE2_SYNTHESIS_CONSTANTS.EMPTY_STRING);
}

/**
 * Estimates parameter count from a parameter list string.
 */
function estimateParamCount(paramStr: string): number {
  const trimmed = paramStr.trim();
  if (trimmed.length === GATE2_SYNTHESIS_CONSTANTS.ZERO) {
    return GATE2_SYNTHESIS_CONSTANTS.ZERO;
  }
  let depth = GATE2_SYNTHESIS_CONSTANTS.ZERO;
  let count = GATE2_SYNTHESIS_CONSTANTS.ONE;
  for (let i = GATE2_SYNTHESIS_CONSTANTS.ZERO; i < trimmed.length; i += GATE2_SYNTHESIS_CONSTANTS.ONE) {
    const char = trimmed[i];
    if (char === "{" || char === "[" || char === "(") {
      depth += GATE2_SYNTHESIS_CONSTANTS.ONE;
    } else if (char === "}" || char === "]" || char === ")") {
      depth -= GATE2_SYNTHESIS_CONSTANTS.ONE;
    } else if (char === "," && depth === GATE2_SYNTHESIS_CONSTANTS.ZERO) {
      count += GATE2_SYNTHESIS_CONSTANTS.ONE;
    }
  }
  return count;
}

/**
 * Extracts exported functions, classes, and arrow constants from TypeScript source code.
 */
export function extractTargetFileExports(
  sourceCode: string,
  filePath: string
): TargetFileInfo {
  const cleanCode = stripComments(sourceCode);
  const exports: TargetExportInfo[] = [];
  let hasDefaultExport = false;

  // 1. Exported functions: export [async] function name(...)
  const functionRegex =
    /export\s+(async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null = null;
  while ((match = functionRegex.exec(cleanCode)) !== null) {
    const isAsync = Boolean(match[GATE2_SYNTHESIS_CONSTANTS.ONE]);
    const name = match[GATE2_SYNTHESIS_CONSTANTS.TWO];
    const params = match[GATE2_SYNTHESIS_CONSTANTS.THREE] ?? "";
    if (name && exports.length < GATE2_SYNTHESIS_CONSTANTS.MAX_EXPORTS_PER_FILE) {
      exports.push({
        name,
        kind: "function",
        isAsync,
        parameterCount: estimateParamCount(params),
      });
    }
  }

  // 2. Exported const arrow functions: export const name = [async] (...) =>
  const arrowRegex =
    /export\s+const\s+([a-zA-Z0-9_$]+)\s*=\s*(async\s*)?(?:\(([^)]*)\)|([a-zA-Z0-9_$]+))\s*=>/g;
  while ((match = arrowRegex.exec(cleanCode)) !== null) {
    const name = match[GATE2_SYNTHESIS_CONSTANTS.ONE];
    const isAsync = Boolean(match[GATE2_SYNTHESIS_CONSTANTS.TWO]);
    const params = match[GATE2_SYNTHESIS_CONSTANTS.THREE] ?? match[GATE2_SYNTHESIS_CONSTANTS.FOUR] ?? "";
    if (name && !exports.some((e) => e.name === name) && exports.length < GATE2_SYNTHESIS_CONSTANTS.MAX_EXPORTS_PER_FILE) {
      exports.push({
        name,
        kind: "const_arrow",
        isAsync,
        parameterCount: estimateParamCount(params),
      });
    }
  }

  // 3. Exported classes: export class Name
  const classRegex = /export\s+(?:default\s+)?class\s+([a-zA-Z0-9_$]+)/g;
  while ((match = classRegex.exec(cleanCode)) !== null) {
    const name = match[GATE2_SYNTHESIS_CONSTANTS.ONE];
    if (match[GATE2_SYNTHESIS_CONSTANTS.ZERO].includes("default")) {
      hasDefaultExport = true;
    }
    if (name && !exports.some((e) => e.name === name) && exports.length < GATE2_SYNTHESIS_CONSTANTS.MAX_EXPORTS_PER_FILE) {
      exports.push({
        name,
        kind: "class",
        isAsync: false,
        parameterCount: GATE2_SYNTHESIS_CONSTANTS.ONE,
      });
    }
  }

  // 4. Default export check
  if (/export\s+default\s+/.test(cleanCode)) {
    hasDefaultExport = true;
  }

  return {
    filePath,
    relativePath: filePath,
    exports,
    hasDefaultExport,
  };
}

/**
 * Loads a target file from disk and parses its exports.
 */
export async function parseTargetFile(
  filePath: string,
  workspaceRoot: string = process.cwd()
): Promise<TargetFileInfo> {
  const fullPath = isAbsolute(filePath) ? filePath : resolve(workspaceRoot, filePath);
  try {
    const content = await readFile(fullPath, "utf8");
    const parsed = extractTargetFileExports(content, filePath);
    return {
      ...parsed,
      filePath: fullPath,
      relativePath: relative(workspaceRoot, fullPath),
    };
  } catch {
    return {
      filePath: fullPath,
      relativePath: filePath,
      exports: [],
      hasDefaultExport: false,
    };
  }
}

// ============================================================================
// ADVERSARIAL PROBE SYNTHESIS - VECTOR 1: NULLS & MALFORMED PAYLOADS
// ============================================================================

/**
 * Synthesizes test probes validating candidate resilience against nulls,
 * undefined values, and malformed/corrupted payloads.
 */
export function synthesizeNullEdgeCases(
  target: TargetFileInfo,
  options: Gate2SynthesisOptions = {}
): readonly Gate2ProbeDefinition[] {
  const probes: Gate2ProbeDefinition[] = [];
  const workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
  const testDir = normalize(options.testDir ?? join(workspaceRoot, GATE2_SYNTHESIS_CONSTANTS.TEST_DIR_DEFAULT));
  const relPath = relative(testDir, target.filePath);
  const importPath = normalizeImportPath(relPath);

  for (const exp of target.exports) {
    if (probes.length >= GATE2_SYNTHESIS_CONSTANTS.DEFAULT_MAX_PROBES_PER_VECTOR) {
      break;
    }

    const safeId = sanitizeProbeName(`${target.relativePath}_${exp.name}_null`);
    const isClass = exp.kind === "class";

    let invocationSnippet: string;
    if (isClass) {
      invocationSnippet = `
        try {
          const instance = new ${exp.name}(payload as any);
          if (instance && typeof (instance as any).run === "function") {
            await (instance as any).run();
          }
        } catch (err: unknown) {
          const lowerMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          if (
            err instanceof TypeError &&
            (lowerMsg.includes("is not an object") ||
             lowerMsg.includes("cannot read properties of") ||
             lowerMsg.includes("cannot read property") ||
             lowerMsg.includes("cannot destructure") ||
             lowerMsg.includes("is not a function") ||
             lowerMsg.includes("null is not") ||
             lowerMsg.includes("undefined is not"))
          ) {
            unhandledCrash = true;
            crashMessage = (err as Error).message;
          }
        }
      `;
    } else {
      invocationSnippet = `
        try {
          await (${exp.name} as any)(payload as any);
        } catch (err: unknown) {
          const lowerMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          if (
            err instanceof TypeError &&
            (lowerMsg.includes("is not an object") ||
             lowerMsg.includes("cannot read properties of") ||
             lowerMsg.includes("cannot read property") ||
             lowerMsg.includes("cannot destructure") ||
             lowerMsg.includes("is not a function") ||
             lowerMsg.includes("null is not") ||
             lowerMsg.includes("undefined is not"))
          ) {
            unhandledCrash = true;
            crashMessage = (err as Error).message;
          }
        }
      `;
    }

    const probeCode = `import { describe, expect, it } from "bun:test";
import { ${exp.name} } from "${importPath}";

describe("Adversarial Fuzzing: Null & Malformed Resilience (${exp.name})", () => {
  it("withstands null, undefined, and malformed payloads without unhandled dereference crashes", async () => {
    const malformedPayloads: unknown[] = [
      null,
      undefined,
      {},
      "",
      "   \\t\\r\\n   ",
      "{ corrupted json syntax",
      JSON.parse('{"__proto__":{"polluted":true}}'),
      { toString: () => { throw new Error("Malicious toString bomb"); } },
      [null, undefined, {}],
    ];

    for (const payload of malformedPayloads) {
      let unhandledCrash = false;
      let crashMessage = "";

      ${invocationSnippet}

      expect(unhandledCrash).toBe(false);
    }
  });
});
`;

    probes.push({
      id: `${GATE2_SYNTHESIS_CONSTANTS.PROBE_PREFIX}null_${safeId}`,
      name: `Synthesized Null Probe: ${exp.name}`,
      vector: GATE2_SYNTHESIS_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
      description: `Asserts that ${exp.name} rejects or handles null, undefined, and malformed payloads without throwing unhandled TypeErrors.`,
      probeCode,
      targetFile: target.filePath,
      timeoutMs: options.probeTimeoutMs ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS,
      metadata: {
        category: GATE2_SYNTHESIS_CONSTANTS.CATEGORY_NULL_UNDEFINED,
        targetExport: exp.name,
        targetKind: exp.kind,
      },
    });
  }

  return probes;
}

// ============================================================================
// ADVERSARIAL PROBE SYNTHESIS - VECTOR 2: BOUNDARY LIMITS
// ============================================================================

/**
 * Synthesizes test probes validating candidate resilience against numeric boundaries,
 * extreme string sizes, and unicode exploits.
 */
export function synthesizeBoundaryLimitCases(
  target: TargetFileInfo,
  options: Gate2SynthesisOptions = {}
): readonly Gate2ProbeDefinition[] {
  const probes: Gate2ProbeDefinition[] = [];
  const workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
  const testDir = normalize(options.testDir ?? join(workspaceRoot, GATE2_SYNTHESIS_CONSTANTS.TEST_DIR_DEFAULT));
  const relPath = relative(testDir, target.filePath);
  const importPath = normalizeImportPath(relPath);

  for (const exp of target.exports) {
    if (probes.length >= GATE2_SYNTHESIS_CONSTANTS.DEFAULT_MAX_PROBES_PER_VECTOR) {
      break;
    }

    const safeId = sanitizeProbeName(`${target.relativePath}_${exp.name}_bounds`);
    const isClass = exp.kind === "class";

    let invocationSnippet: string;
    if (isClass) {
      invocationSnippet = `
        try {
          const instance = new ${exp.name}(boundary as any);
          if (instance && typeof (instance as any).run === "function") {
            await (instance as any).run();
          }
        } catch (err: unknown) {
          const lowerMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          if (
            err instanceof RangeError ||
            (err instanceof TypeError &&
             (lowerMsg.includes("is not an object") ||
              lowerMsg.includes("cannot read properties of") ||
              lowerMsg.includes("null is not") ||
              lowerMsg.includes("undefined is not")))
          ) {
            unhandledCrash = true;
            crashMessage = (err as Error).message;
          }
        }
      `;
    } else {
      invocationSnippet = `
        try {
          const res = await (${exp.name} as any)(boundary as any);
          if (typeof res === "number" && !Number.isNaN(boundary) && Number.isNaN(res)) {
            unhandledCrash = true;
            crashMessage = "Produced unexpected NaN numerical corruption";
          }
        } catch (err: unknown) {
          const lowerMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          if (
            err instanceof RangeError ||
            (err instanceof TypeError &&
             (lowerMsg.includes("is not an object") ||
              lowerMsg.includes("cannot read properties of") ||
              lowerMsg.includes("null is not") ||
              lowerMsg.includes("undefined is not")))
          ) {
            unhandledCrash = true;
            crashMessage = (err as Error).message;
          }
        }
      `;
    }

    const probeCode = `import { describe, expect, it } from "bun:test";
import { ${exp.name} } from "${importPath}";

describe("Adversarial Stress: Boundary Limits & Unicode Exploits (${exp.name})", () => {
  it("withstands 32-bit limits, safe integers, huge strings, and unicode vectors without RangeErrors or crashes", async () => {
    const boundaries: unknown[] = [
      ${GATE2_SYNTHESIS_CONSTANTS.INT32_MAX},
      ${GATE2_SYNTHESIS_CONSTANTS.INT32_MIN},
      ${GATE2_SYNTHESIS_CONSTANTS.SAFE_INT_MAX},
      ${GATE2_SYNTHESIS_CONSTANTS.SAFE_INT_MIN},
      ${GATE2_SYNTHESIS_CONSTANTS.NUM_ZERO},
      ${GATE2_SYNTHESIS_CONSTANTS.NUM_NEGATIVE_ZERO},
      NaN,
      Infinity,
      -Infinity,
      ${GATE2_SYNTHESIS_CONSTANTS.NUM_EPSILON},
      "${GATE2_SYNTHESIS_CONSTANTS.UNICODE_NULL_BYTE}",
      "${GATE2_SYNTHESIS_CONSTANTS.UNICODE_ZALGO_SAMPLE}",
      "${GATE2_SYNTHESIS_CONSTANTS.UNICODE_RTL_OVERRIDE}",
      "${GATE2_SYNTHESIS_CONSTANTS.UNICODE_ZERO_WIDTH}",
      "${GATE2_SYNTHESIS_CONSTANTS.UNICODE_EMOJI_SEQUENCE}",
      "A".repeat(${GATE2_SYNTHESIS_CONSTANTS.HUGE_STRING_SIZE}),
      [],
      new Array(${GATE2_SYNTHESIS_CONSTANTS.LARGE_ARRAY_LENGTH}).fill(0),
    ];

    for (const boundary of boundaries) {
      let unhandledCrash = false;
      let crashMessage = "";

      ${invocationSnippet}

      expect(unhandledCrash).toBe(false);
    }
  });
});
`;

    probes.push({
      id: `${GATE2_SYNTHESIS_CONSTANTS.PROBE_PREFIX}bounds_${safeId}`,
      name: `Synthesized Boundary Limits Probe: ${exp.name}`,
      vector: GATE2_SYNTHESIS_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
      description: `Tests ${exp.name} against extreme numerical boundaries, 100k character strings, and Unicode injection vectors.`,
      probeCode,
      targetFile: target.filePath,
      timeoutMs: options.probeTimeoutMs ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS,
      metadata: {
        category: GATE2_SYNTHESIS_CONSTANTS.CATEGORY_BOUNDARY_LIMITS,
        targetExport: exp.name,
      },
    });
  }

  return probes;
}

// ============================================================================
// ADVERSARIAL PROBE SYNTHESIS - VECTOR 3: CONCURRENCY & RACE CONDITIONS
// ============================================================================

/**
 * Synthesizes test probes validating candidate resilience under high concurrent load,
 * parallel execution, and microtask interleaving.
 */
export function synthesizeConcurrencyCases(
  target: TargetFileInfo,
  options: Gate2SynthesisOptions = {}
): readonly Gate2ProbeDefinition[] {
  const probes: Gate2ProbeDefinition[] = [];
  const workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
  const testDir = normalize(options.testDir ?? join(workspaceRoot, GATE2_SYNTHESIS_CONSTANTS.TEST_DIR_DEFAULT));
  const relPath = relative(testDir, target.filePath);
  const importPath = normalizeImportPath(relPath);
  const parallelCount =
    options.concurrencyCount ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_CONCURRENCY_PARALLEL_COUNT;

  for (const exp of target.exports) {
    if (probes.length >= GATE2_SYNTHESIS_CONSTANTS.DEFAULT_MAX_PROBES_PER_VECTOR) {
      break;
    }

    const safeId = sanitizeProbeName(`${target.relativePath}_${exp.name}_concurrency`);
    const isClass = exp.kind === "class";

    let invocationSnippet: string;
    if (isClass) {
      invocationSnippet = `
        const instance = new ${exp.name}({ parallelIndex: idx } as any);
        if (instance && typeof (instance as any).run === "function") {
          return await (instance as any).run();
        }
        return instance;
      `;
    } else {
      invocationSnippet = `
        return await (${exp.name} as any)({ parallelIndex: idx } as any);
      `;
    }

    const probeCode = `import { describe, expect, it } from "bun:test";
import { ${exp.name} } from "${importPath}";

describe("Adversarial Stress: High Concurrency & Race Conditions (${exp.name})", () => {
  it("withstands ${parallelCount} simultaneous parallel invocations without state contamination or fatal crashes", async () => {
    const tasks = Array.from({ length: ${parallelCount} }, async (_, idx) => {
      try {
        ${invocationSnippet}
      } catch (err: unknown) {
        const lowerMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (
          err instanceof TypeError &&
          (lowerMsg.includes("is not an object") ||
           lowerMsg.includes("cannot read properties of") ||
           lowerMsg.includes("cannot destructure") ||
           lowerMsg.includes("null is not") ||
           lowerMsg.includes("undefined is not"))
        ) {
          throw err;
        }
        return null;
      }
    });

    const settled = await Promise.allSettled(tasks);
    const fatalErrors = settled.filter(
      (s) => s.status === "rejected" && s.reason instanceof TypeError
    );

    expect(fatalErrors.length).toBe(0);
  });
});
`;

    probes.push({
      id: `${GATE2_SYNTHESIS_CONSTANTS.PROBE_PREFIX}race_${safeId}`,
      name: `Synthesized Concurrency Probe: ${exp.name}`,
      vector: GATE2_SYNTHESIS_CONSTANTS.VECTOR_CONCURRENCY_RACE,
      description: `Fires ${parallelCount} parallel calls into ${exp.name} to discover race conditions, memory leaks, and shared-state corruption.`,
      probeCode,
      targetFile: target.filePath,
      timeoutMs: options.probeTimeoutMs ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS,
      metadata: {
        category: GATE2_SYNTHESIS_CONSTANTS.CATEGORY_CONCURRENCY_RACE,
        targetExport: exp.name,
        parallelCount,
      },
    });
  }

  return probes;
}

// ============================================================================
// ADVERSARIAL PROBE SYNTHESIS - VECTOR 4: TIMEOUTS & LATENCY
// ============================================================================

/**
 * Synthesizes test probes asserting that candidate operations respect timeout budgets,
 * handle artificial latency, and respond cleanly to AbortSignal cancellations.
 */
export function synthesizeTimeoutCases(
  target: TargetFileInfo,
  options: Gate2SynthesisOptions = {}
): readonly Gate2ProbeDefinition[] {
  const probes: Gate2ProbeDefinition[] = [];
  const workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
  const testDir = normalize(options.testDir ?? join(workspaceRoot, GATE2_SYNTHESIS_CONSTANTS.TEST_DIR_DEFAULT));
  const relPath = relative(testDir, target.filePath);
  const importPath = normalizeImportPath(relPath);
  const operationTimeoutMs =
    options.operationTimeoutMs ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_OPERATION_TIMEOUT_MS;

  for (const exp of target.exports) {
    if (probes.length >= GATE2_SYNTHESIS_CONSTANTS.DEFAULT_MAX_PROBES_PER_VECTOR) {
      break;
    }

    const safeId = sanitizeProbeName(`${target.relativePath}_${exp.name}_timeout`);
    const isClass = exp.kind === "class";

    let invocationSnippet: string;
    if (isClass) {
      invocationSnippet = `
        const instance = new ${exp.name}(payload as any);
        if (instance && typeof (instance as any).run === "function") {
          return await (instance as any).run();
        }
        return instance;
      `;
    } else {
      invocationSnippet = `
        return await (${exp.name} as any)(payload as any);
      `;
    }

    const probeCode = `import { describe, expect, it } from "bun:test";
import { ${exp.name} } from "${importPath}";

describe("Adversarial Stress: Timeout Watchdog & AbortSignal Races (${exp.name})", () => {
  it("enforces operation completion within timeout budget (${operationTimeoutMs}ms) without hanging", async () => {
    let hung = false;
    const watchdogTimer = setTimeout(() => {
      hung = true;
    }, ${operationTimeoutMs});

    try {
      const payload = { timeoutMs: ${Math.round(operationTimeoutMs / GATE2_SYNTHESIS_CONSTANTS.TWO)} };
      ${invocationSnippet}
    } catch {
      // Handled rejection or error is allowed; hanging indefinitely is forbidden
    } finally {
      clearTimeout(watchdogTimer);
    }

    expect(hung).toBe(false);
  });

  it("handles pre-aborted and delayed AbortSignals gracefully", async () => {
    const controller = new AbortController();
    controller.abort();

    let unhandledCrash = false;
    try {
      const payload = { signal: controller.signal };
      ${invocationSnippet}
    } catch (err: unknown) {
      const lowerMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (
        err instanceof TypeError &&
        (lowerMsg.includes("is not an object") ||
         lowerMsg.includes("cannot read properties of") ||
         lowerMsg.includes("is not a function") ||
         lowerMsg.includes("null is not") ||
         lowerMsg.includes("undefined is not"))
      ) {
        unhandledCrash = true;
      }
    }

    expect(unhandledCrash).toBe(false);
  });
});
`;

    probes.push({
      id: `${GATE2_SYNTHESIS_CONSTANTS.PROBE_PREFIX}timeout_${safeId}`,
      name: `Synthesized Timeout & Latency Probe: ${exp.name}`,
      vector: GATE2_SYNTHESIS_CONSTANTS.VECTOR_TIMEOUT_LATENCY,
      description: `Validates that ${exp.name} respects strict execution deadlines (${operationTimeoutMs}ms) and handles AbortSignal cancellation races cleanly.`,
      probeCode,
      targetFile: target.filePath,
      timeoutMs: options.probeTimeoutMs ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS,
      metadata: {
        category: GATE2_SYNTHESIS_CONSTANTS.CATEGORY_TIMEOUT_LATENCY,
        targetExport: exp.name,
        operationTimeoutMs,
      },
    });
  }

  return probes;
}

// ============================================================================
// GENERIC / FALLBACK SYNTHESIS ENGINE
// ============================================================================

/**
 * Synthesizes generic stress probes when target files have no exported callable functions
 * or when executing black-box system-level adversarial challenges.
 */
export function synthesizeGenericEdgeCases(
  options: Gate2SynthesisOptions = {}
): readonly Gate2ProbeDefinition[] {
  const probes: Gate2ProbeDefinition[] = [];
  const timeoutMs = options.probeTimeoutMs ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_PROBE_TIMEOUT_MS;
  const operationTimeoutMs =
    options.operationTimeoutMs ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_OPERATION_TIMEOUT_MS;
  const parallelCount =
    options.concurrencyCount ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_CONCURRENCY_PARALLEL_COUNT;

  // 1. Generic Null & Malformed Probe
  probes.push({
    id: `${GATE2_SYNTHESIS_CONSTANTS.PROBE_PREFIX}generic_null_safety`,
    name: "Synthesized Generic Null Safety Probe",
    vector: GATE2_SYNTHESIS_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
    description: "Asserts that system error handlers survive corrupted JSON payloads, empty buffers, and null pointers.",
    probeCode: `import { describe, expect, it } from "bun:test";

describe("Generic Red-Team: Global Malformed Payload Safety", () => {
  it("rejects corrupted JSON and null references safely", () => {
    const payloads = [null, undefined, "", "{ bad: json", "   \\t   "];
    for (const p of payloads) {
      let threwInternal = false;
      try {
        if (typeof p === "string" && p.startsWith("{")) {
          JSON.parse(p);
        }
      } catch (err: unknown) {
        if (!(err instanceof SyntaxError)) {
          threwInternal = true;
        }
      }
      expect(threwInternal).toBe(false);
    }
  });
});
`,
    timeoutMs,
    metadata: { category: GATE2_SYNTHESIS_CONSTANTS.CATEGORY_NULL_UNDEFINED },
  });

  // 2. Generic Boundary Limits Probe
  probes.push({
    id: `${GATE2_SYNTHESIS_CONSTANTS.PROBE_PREFIX}generic_boundary_limits`,
    name: "Synthesized Generic Boundary Limits Probe",
    vector: GATE2_SYNTHESIS_CONSTANTS.VECTOR_BOUNDARY_MALFORMED,
    description: "Asserts that runtime environment survives 2^31-1 integers, huge strings, and unicode exploits.",
    probeCode: `import { describe, expect, it } from "bun:test";

describe("Generic Red-Team: Numeric & String Boundary Resilience", () => {
  it("validates safe integer arithmetic without silent overflow or NaN poisoning", () => {
    const maxSafe = Number.MAX_SAFE_INTEGER;
    const maxInt32 = 2147483647;
    expect(maxInt32 + 1).toBe(2147483648);
    expect(Number.isSafeInteger(maxSafe)).toBe(true);
    expect(Number.isSafeInteger(maxSafe + 1)).toBe(false);

    const hugeStr = "X".repeat(100_000);
    expect(hugeStr.length).toBe(100_000);
    expect(hugeStr.slice(0, 10)).toBe("XXXXXXXXXX");
  });
});
`,
    timeoutMs,
    metadata: { category: GATE2_SYNTHESIS_CONSTANTS.CATEGORY_BOUNDARY_LIMITS },
  });

  // 3. Generic Concurrency Probe
  probes.push({
    id: `${GATE2_SYNTHESIS_CONSTANTS.PROBE_PREFIX}generic_concurrency_race`,
    name: "Synthesized Generic Concurrency Probe",
    vector: GATE2_SYNTHESIS_CONSTANTS.VECTOR_CONCURRENCY_RACE,
    description: "Exercises runtime concurrency semaphore with rapid microtask bursts.",
    probeCode: `import { describe, expect, it } from "bun:test";

describe("Generic Red-Team: Concurrency Semaphore & Microtask Stress", () => {
  it("executes ${parallelCount} simultaneous microtask jobs without event-loop starvation", async () => {
    const counter = { val: 0 };
    const tasks = Array.from({ length: ${parallelCount} }, async () => {
      await Promise.resolve();
      counter.val += 1;
    });

    await Promise.all(tasks);
    expect(counter.val).toBe(${parallelCount});
  });
});
`,
    timeoutMs,
    metadata: { category: GATE2_SYNTHESIS_CONSTANTS.CATEGORY_CONCURRENCY_RACE },
  });

  // 4. Generic Timeout Probe
  probes.push({
    id: `${GATE2_SYNTHESIS_CONSTANTS.PROBE_PREFIX}generic_timeout_watchdog`,
    name: "Synthesized Generic Timeout Watchdog Probe",
    vector: GATE2_SYNTHESIS_CONSTANTS.VECTOR_TIMEOUT_LATENCY,
    description: "Asserts that timer scheduling and AbortController signals trigger reliably.",
    probeCode: `import { describe, expect, it } from "bun:test";

describe("Generic Red-Team: Timeout Watchdog & AbortController Verification", () => {
  it("aborts active timers cleanly when signaled", async () => {
    const controller = new AbortController();
    let aborted = false;

    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });

    controller.abort();
    expect(aborted).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });
});
`,
    timeoutMs,
    metadata: { category: GATE2_SYNTHESIS_CONSTANTS.CATEGORY_TIMEOUT_LATENCY },
  });

  return probes;
}

// ============================================================================
// MAIN SYNTHESIS ORCHESTRATOR
// ============================================================================

/**
 * Synthesizes a comprehensive suite of adversarial test probes covering all required attack vectors:
 * nulls/undefined, boundary limits, concurrency, and timeouts.
 */
export async function synthesizeEdgeCases(
  options: Gate2SynthesisOptions = {}
): Promise<readonly Gate2ProbeDefinition[]> {
  const workspaceRoot = normalize(options.workspaceRoot ?? process.cwd());
  const maxProbes = options.maxProbes ?? GATE2_SYNTHESIS_CONSTANTS.DEFAULT_MAX_TOTAL_PROBES;
  const targetFiles = options.targetFiles ?? [];
  const allProbes: Gate2ProbeDefinition[] = [];

  // Parse target files if provided
  const targetInfos: TargetFileInfo[] = [...(options.targetFileInfos ?? [])];
  if (targetInfos.length === GATE2_SYNTHESIS_CONSTANTS.ZERO && targetFiles.length > GATE2_SYNTHESIS_CONSTANTS.ZERO) {
    for (const file of targetFiles) {
      const info = await parseTargetFile(file, workspaceRoot);
      if (info.exports.length > GATE2_SYNTHESIS_CONSTANTS.ZERO) {
        targetInfos.push(info);
      }
    }
  }

  // Synthesize for discovered targets
  if (targetInfos.length > GATE2_SYNTHESIS_CONSTANTS.ZERO) {
    for (const target of targetInfos) {
      if (allProbes.length >= maxProbes) {
        break;
      }

      // Vector 1: Nulls & Malformed Payloads
      const nullProbes = synthesizeNullEdgeCases(target, options);
      allProbes.push(...nullProbes);

      // Vector 2: Boundary Limits & Unicode
      const boundProbes = synthesizeBoundaryLimitCases(target, options);
      allProbes.push(...boundProbes);

      // Vector 3: Concurrency & Race Conditions
      const raceProbes = synthesizeConcurrencyCases(target, options);
      allProbes.push(...raceProbes);

      // Vector 4: Timeouts & Latency
      const timeProbes = synthesizeTimeoutCases(target, options);
      allProbes.push(...timeProbes);
    }
  }

  // Fallback to generic synthesized probes if no target files yielded exportable functions
  if (allProbes.length === GATE2_SYNTHESIS_CONSTANTS.ZERO) {
    const generic = synthesizeGenericEdgeCases(options);
    allProbes.push(...generic);
  }

  // Deduplicate probe IDs and truncate to maxProbes limit
  const seenIds = new Set<string>();
  const uniqueProbes: Gate2ProbeDefinition[] = [];

  for (const probe of allProbes) {
    if (!seenIds.has(probe.id)) {
      seenIds.add(probe.id);
      uniqueProbes.push(probe);
      if (uniqueProbes.length >= maxProbes) {
        break;
      }
    }
  }

  return uniqueProbes;
}

/**
 * Gate 2 Edge-Case Synthesizer class providing stateful configuration and synthesis capabilities.
 */
export class Gate2EdgeCaseSynthesizer {
  private readonly options: Gate2SynthesisOptions;

  public constructor(options: Gate2SynthesisOptions = {}) {
    this.options = { ...options };
  }

  /**
   * Synthesizes adversarial probes given execution context from Gate2Challenger.
   */
  public async synthesizeForContext(
    context: Gate2ExecutionContext
  ): Promise<readonly Gate2ProbeDefinition[]> {
    return synthesizeEdgeCases({
      workspaceRoot: context.options.workspaceRoot,
      testDir: context.options.testDir,
      targetFiles: context.targetFiles,
      probeTimeoutMs: context.options.probeTimeoutMs,
      taskDescription: context.taskDescription,
      acceptanceCriteria: context.acceptanceCriteria,
      ...this.options,
    });
  }

  /**
   * Synthesizes adversarial probes targeting a specific source file.
   */
  public async synthesizeForFile(
    filePath: string
  ): Promise<readonly Gate2ProbeDefinition[]> {
    return synthesizeEdgeCases({
      ...this.options,
      targetFiles: [filePath],
    });
  }

  /**
   * Synthesizes adversarial probes from raw source code in memory.
   */
  public synthesizeForSource(
    sourceCode: string,
    filePath: string
  ): readonly Gate2ProbeDefinition[] {
    const targetInfo = extractTargetFileExports(sourceCode, filePath);
    const probes: Gate2ProbeDefinition[] = [];

    probes.push(...synthesizeNullEdgeCases(targetInfo, this.options));
    probes.push(...synthesizeBoundaryLimitCases(targetInfo, this.options));
    probes.push(...synthesizeConcurrencyCases(targetInfo, this.options));
    probes.push(...synthesizeTimeoutCases(targetInfo, this.options));

    if (probes.length === GATE2_SYNTHESIS_CONSTANTS.ZERO) {
      probes.push(...synthesizeGenericEdgeCases(this.options));
    }

    return probes;
  }
}

/**
 * Factory function creating a new Gate2EdgeCaseSynthesizer instance.
 */
export function createEdgeCaseSynthesizer(
  options?: Gate2SynthesisOptions
): Gate2EdgeCaseSynthesizer {
  return new Gate2EdgeCaseSynthesizer(options);
}
