/**
 * Unit Test Suite for Gate 2: Automated Edge-Case Synthesis Engine (Task 1.2).
 *
 * Validates automated synthesis of red-team fuzzing and stress probes across all four attack vectors:
 * 1. Nulls, undefined, and malformed/corrupted payloads
 * 2. Boundary limits (2^31 - 1, safe integers, huge strings, unicode exploits)
 * 3. Concurrency and race conditions (high parallel Promise.all bursts)
 * 4. Timeouts, latency, and AbortSignal cancellation
 *
 * Implemented in accordance with OpenSpec change `looper-gate2-adversarial-challenger` Task 1.2
 * and `projects/agnostic_looper/SPECIFICATION.md` Section 3.1 & Section 3.4 (LOOPER-GATE-003).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GATE2_SYNTHESIS_CONSTANTS,
  Gate2EdgeCaseSynthesizer,
  createEdgeCaseSynthesizer,
  extractTargetFileExports,
  normalizeImportPath,
  parseTargetFile,
  stripComments,
  synthesizeBoundaryLimitCases,
  synthesizeConcurrencyCases,
  synthesizeEdgeCases,
  synthesizeGenericEdgeCases,
  synthesizeNullEdgeCases,
  synthesizeTimeoutCases,
  type TargetFileInfo,
} from "../../src/gates/gate2_synthesis";
import {
  GATE2_CONSTANTS,
  Gate2Challenger,
  defaultProbeRunner,
  type Gate2ExecutionContext,
} from "../../src/gates/gate2_challenger";
import { LOOPER_EVENTS } from "../../src/core/fsm_types";

describe("Gate 2: Automated Edge-Case Synthesis Engine (Task 1.2)", () => {
  let tempDir: string;
  let srcDir: string;
  let testDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `gate2-synthesis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
      // Ignore cleanup error
    }
  });

  describe("GATE2_SYNTHESIS_CONSTANTS", () => {
    it("exposes canonical attack vector identifiers", () => {
      expect(GATE2_SYNTHESIS_CONSTANTS.VECTOR_BOUNDARY_MALFORMED).toBe("boundary_malformed");
      expect(GATE2_SYNTHESIS_CONSTANTS.VECTOR_CONCURRENCY_RACE).toBe("concurrency_race");
      expect(GATE2_SYNTHESIS_CONSTANTS.VECTOR_RESOURCE_EXHAUSTION).toBe("resource_exhaustion");
      expect(GATE2_SYNTHESIS_CONSTANTS.VECTOR_TIMEOUT_LATENCY).toBe("timeout_latency");
    });

    it("exposes canonical edge-case category identifiers", () => {
      expect(GATE2_SYNTHESIS_CONSTANTS.CATEGORY_NULL_UNDEFINED).toBe("null_undefined");
      expect(GATE2_SYNTHESIS_CONSTANTS.CATEGORY_BOUNDARY_LIMITS).toBe("boundary_limits");
      expect(GATE2_SYNTHESIS_CONSTANTS.CATEGORY_CONCURRENCY_RACE).toBe("concurrency_race");
      expect(GATE2_SYNTHESIS_CONSTANTS.CATEGORY_TIMEOUT_LATENCY).toBe("timeout_latency");
    });

    it("defines strict numeric boundaries without magic numbers", () => {
      expect(GATE2_SYNTHESIS_CONSTANTS.INT32_MAX).toBe(2147483647);
      expect(GATE2_SYNTHESIS_CONSTANTS.INT32_MIN).toBe(-2147483648);
      expect(GATE2_SYNTHESIS_CONSTANTS.SAFE_INT_MAX).toBe(Number.MAX_SAFE_INTEGER);
      expect(GATE2_SYNTHESIS_CONSTANTS.SAFE_INT_MIN).toBe(Number.MIN_SAFE_INTEGER);
      expect(GATE2_SYNTHESIS_CONSTANTS.HUGE_STRING_SIZE).toBe(100_000);
      expect(GATE2_SYNTHESIS_CONSTANTS.DEFAULT_CONCURRENCY_PARALLEL_COUNT).toBe(20);
    });

    it("defines unicode and string boundary samples", () => {
      expect(GATE2_SYNTHESIS_CONSTANTS.UNICODE_NULL_BYTE).toBe("\0");
      expect(GATE2_SYNTHESIS_CONSTANTS.UNICODE_RTL_OVERRIDE).toContain("\u202E");
      expect(GATE2_SYNTHESIS_CONSTANTS.UNICODE_ZERO_WIDTH).toContain("\u200B");
      expect(GATE2_SYNTHESIS_CONSTANTS.EMPTY_STRING).toBe("");
    });
  });

  describe("Static Code Analysis & Export Extraction", () => {
    it("extracts exported functions, async functions, arrow functions, and classes", () => {
      const code = `
        // Line comment
        /* Block comment */
        export function computeTotal(items: unknown[], taxRate = 0.1): number {
          return 42;
        }

        export async function fetchData(endpoint: string, options?: unknown): Promise<unknown> {
          return { ok: true };
        }

        export const parsePayload = (raw: string, strict = false) => {
          return JSON.parse(raw);
        };

        export class PaymentService {
          constructor(private config: unknown) {}
          run() { return true; }
        }

        function privateHelper() { return false; }
      `;

      const targetInfo = extractTargetFileExports(code, "src/service.ts");
      expect(targetInfo.filePath).toBe("src/service.ts");
      expect(targetInfo.exports.length).toBe(4);

      const compute = targetInfo.exports.find((e) => e.name === "computeTotal");
      expect(compute).toBeDefined();
      expect(compute?.kind).toBe("function");
      expect(compute?.isAsync).toBe(false);

      const fetch = targetInfo.exports.find((e) => e.name === "fetchData");
      expect(fetch).toBeDefined();
      expect(fetch?.kind).toBe("function");
      expect(fetch?.isAsync).toBe(true);

      const parse = targetInfo.exports.find((e) => e.name === "parsePayload");
      expect(parse).toBeDefined();
      expect(parse?.kind).toBe("const_arrow");

      const payment = targetInfo.exports.find((e) => e.name === "PaymentService");
      expect(payment).toBeDefined();
      expect(payment?.kind).toBe("class");
    });

    it("stripComments removes comments without altering actual code structure", () => {
      const code = `
        // export function fakeOne() {}
        /* export function fakeTwo() {} */
        export function realOne() {}
      `;
      const clean = stripComments(code);
      expect(clean).not.toContain("fakeOne");
      expect(clean).not.toContain("fakeTwo");
      expect(clean).toContain("realOne");
    });

    it("normalizeImportPath generates posix-compliant paths and removes .ts suffix", () => {
      expect(normalizeImportPath("../src/service.ts")).toBe("../src/service");
      expect(normalizeImportPath("src/calculator.ts")).toBe("./src/calculator");
      expect(normalizeImportPath("./helper.ts")).toBe("./helper");
    });

    it("parseTargetFile loads and parses file from filesystem", async () => {
      const filePath = join(srcDir, "sample.ts");
      await writeFile(
        filePath,
        `export function validateInput(val: unknown): boolean { return val !== null; }`,
        "utf8"
      );

      const info = await parseTargetFile(filePath, tempDir);
      expect(info.exports.length).toBe(1);
      expect(info.exports[0]?.name).toBe("validateInput");
    });
  });

  describe("Vector 1: Automated Null & Malformed Payload Synthesis", () => {
    it("synthesizes probes targeting nulls, undefined, corrupted JSON, and prototype pollution", () => {
      const target: TargetFileInfo = {
        filePath: join(srcDir, "math.ts"),
        relativePath: "src/math.ts",
        exports: [{ name: "add", kind: "function", isAsync: false, parameterCount: 2 }],
        hasDefaultExport: false,
      };

      const probes = synthesizeNullEdgeCases(target, {
        workspaceRoot: tempDir,
        testDir,
      });

      expect(probes.length).toBeGreaterThan(0);
      const probe = probes[0]!;
      expect(probe.vector).toBe("boundary_malformed");
      expect(probe.metadata?.category).toBe("null_undefined");
      expect(probe.probeCode).toContain("null,");
      expect(probe.probeCode).toContain("undefined,");
      expect(probe.probeCode).toContain("corrupted json syntax");
      expect(probe.probeCode).toContain("__proto__");
    });

    it("executes synthesized null probe against robust code and passes cleanly", async () => {
      // 1. Create robust implementation
      const modPath = join(srcDir, "robust_null.ts");
      await writeFile(
        modPath,
        `
        export function safeHandler(payload: unknown): boolean {
          if (!payload || typeof payload !== "object") {
            return false;
          }
          return true;
        }
        `,
        "utf8"
      );

      const targetInfo = await parseTargetFile(modPath, tempDir);
      const probes = synthesizeNullEdgeCases(targetInfo, {
        workspaceRoot: tempDir,
        testDir,
      });

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        probes,
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(result.breakingProbes.length).toBe(0);
    });

    it("executes synthesized null probe against vulnerable code and reproduces breaking failure", async () => {
      // 1. Create vulnerable implementation that crashes on null dereference
      const modPath = join(srcDir, "vulnerable_null.ts");
      await writeFile(
        modPath,
        `
        export function fragileHandler(payload: any): string {
          // Unhandled crash when payload is null or undefined!
          return payload.data.value.toLowerCase();
        }
        `,
        "utf8"
      );

      const targetInfo = await parseTargetFile(modPath, tempDir);
      const probes = synthesizeNullEdgeCases(targetInfo, {
        workspaceRoot: tempDir,
        testDir,
      });

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        probes,
      });

      const result = await challenger.run();
      expect(result.success).toBe(false);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_REPRODUCED_FAILURE);
      expect(result.breakingProbes.length).toBeGreaterThan(0);
      expect(result.report.unhandledFailures.length).toBeGreaterThan(0);
    });
  });

  describe("Vector 2: Automated Boundary Limits & Unicode Synthesis", () => {
    it("synthesizes probes targeting 2^31-1, safe integers, huge strings, and unicode vectors", () => {
      const target: TargetFileInfo = {
        filePath: join(srcDir, "limits.ts"),
        relativePath: "src/limits.ts",
        exports: [{ name: "processRange", kind: "function", isAsync: false, parameterCount: 1 }],
        hasDefaultExport: false,
      };

      const probes = synthesizeBoundaryLimitCases(target, {
        workspaceRoot: tempDir,
        testDir,
      });

      expect(probes.length).toBeGreaterThan(0);
      const probe = probes[0]!;
      expect(probe.vector).toBe("boundary_malformed");
      expect(probe.metadata?.category).toBe("boundary_limits");
      expect(probe.probeCode).toContain("2147483647");
      expect(probe.probeCode).toContain("9007199254740991");
      expect(probe.probeCode).toContain("100000"); // huge string
      expect(probe.probeCode).toContain("reversed_payload"); // RTL override
    });

    it("executes synthesized boundary probe against robust code and survives", async () => {
      const modPath = join(srcDir, "robust_bounds.ts");
      await writeFile(
        modPath,
        `
        export function safeBounds(input: unknown): number {
          if (typeof input === "number") {
            if (Number.isNaN(input) || !Number.isFinite(input)) {
              return 0;
            }
            return Math.min(input, 1000);
          }
          return 0;
        }
        `,
        "utf8"
      );

      const targetInfo = await parseTargetFile(modPath, tempDir);
      const probes = synthesizeBoundaryLimitCases(targetInfo, {
        workspaceRoot: tempDir,
        testDir,
      });

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        probes,
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
    });
  });

  describe("Vector 3: Automated Concurrency & Race Condition Synthesis", () => {
    it("synthesizes probes firing parallel bursts into candidate functions", () => {
      const target: TargetFileInfo = {
        filePath: join(srcDir, "concurrent_svc.ts"),
        relativePath: "src/concurrent_svc.ts",
        exports: [{ name: "handleJob", kind: "function", isAsync: true, parameterCount: 1 }],
        hasDefaultExport: false,
      };

      const probes = synthesizeConcurrencyCases(target, {
        workspaceRoot: tempDir,
        testDir,
        concurrencyCount: 25,
      });

      expect(probes.length).toBeGreaterThan(0);
      const probe = probes[0]!;
      expect(probe.vector).toBe("concurrency_race");
      expect(probe.metadata?.category).toBe("concurrency_race");
      expect(probe.probeCode).toContain("length: 25");
      expect(probe.probeCode).toContain("Promise.allSettled");
    });

    it("executes synthesized concurrency probe and survives with clean state", async () => {
      const modPath = join(srcDir, "atomic_counter.ts");
      await writeFile(
        modPath,
        `
        let counter = 0;
        export async function increment(payload: unknown): Promise<number> {
          await new Promise((r) => setTimeout(r, 2));
          counter += 1;
          return counter;
        }
        `,
        "utf8"
      );

      const targetInfo = await parseTargetFile(modPath, tempDir);
      const probes = synthesizeConcurrencyCases(targetInfo, {
        workspaceRoot: tempDir,
        testDir,
        concurrencyCount: 15,
      });

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        probes,
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
    });
  });

  describe("Vector 4: Automated Timeout Watchdog & Latency Synthesis", () => {
    it("synthesizes probes enforcing operation timeout budgets and AbortSignals", () => {
      const target: TargetFileInfo = {
        filePath: join(srcDir, "network.ts"),
        relativePath: "src/network.ts",
        exports: [{ name: "requestApi", kind: "function", isAsync: true, parameterCount: 1 }],
        hasDefaultExport: false,
      };

      const probes = synthesizeTimeoutCases(target, {
        workspaceRoot: tempDir,
        testDir,
        operationTimeoutMs: 1500,
      });

      expect(probes.length).toBeGreaterThan(0);
      const probe = probes[0]!;
      expect(probe.vector).toBe("timeout_latency");
      expect(probe.metadata?.category).toBe("timeout_latency");
      expect(probe.probeCode).toContain("watchdogTimer");
      expect(probe.probeCode).toContain("AbortController");
    });

    it("executes synthesized timeout probe and passes within watchdog budget", async () => {
      const modPath = join(srcDir, "fast_service.ts");
      await writeFile(
        modPath,
        `
        export async function quickOperation(opts: { timeoutMs?: number; signal?: AbortSignal }): Promise<string> {
          if (opts?.signal?.aborted) {
            throw new Error("Operation aborted");
          }
          return "done";
        }
        `,
        "utf8"
      );

      const targetInfo = await parseTargetFile(modPath, tempDir);
      const probes = synthesizeTimeoutCases(targetInfo, {
        workspaceRoot: tempDir,
        testDir,
      });

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        probes,
      });

      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
    });
  });

  describe("Full Synthesis Orchestrator & Gate2EdgeCaseSynthesizer", () => {
    it("synthesizes edge cases for all 4 vectors given target files", async () => {
      const modPath = join(srcDir, "calculator.ts");
      await writeFile(
        modPath,
        `
        export function add(a: number, b: number): number { return (a ?? 0) + (b ?? 0); }
        export function multiply(a: number, b: number): number { return (a ?? 1) * (b ?? 1); }
        `,
        "utf8"
      );

      const probes = await synthesizeEdgeCases({
        workspaceRoot: tempDir,
        testDir,
        targetFiles: [modPath],
        maxProbes: 12,
      });

      expect(probes.length).toBeGreaterThan(0);
      const vectors = new Set(probes.map((p) => p.vector));
      expect(vectors.has("boundary_malformed")).toBe(true);
      expect(vectors.has("concurrency_race")).toBe(true);
      expect(vectors.has("timeout_latency")).toBe(true);
    });

    it("synthesizes generic fallback probes when target files have no exports", async () => {
      const emptyFilePath = join(srcDir, "empty.ts");
      await writeFile(emptyFilePath, "// Just comments and types\ntype ID = string;", "utf8");

      const probes = await synthesizeEdgeCases({
        workspaceRoot: tempDir,
        testDir,
        targetFiles: [emptyFilePath],
      });

      expect(probes.length).toBe(4);
      expect(probes.some((p) => p.id.includes("generic_null"))).toBe(true);
      expect(probes.some((p) => p.id.includes("generic_boundary"))).toBe(true);
      expect(probes.some((p) => p.id.includes("generic_concurrency"))).toBe(true);
      expect(probes.some((p) => p.id.includes("generic_timeout"))).toBe(true);
    });

    it("synthesizes edge cases from in-memory source string via Gate2EdgeCaseSynthesizer", () => {
      const synthesizer = createEdgeCaseSynthesizer({
        workspaceRoot: tempDir,
        testDir,
      });

      const source = `
        export async function executeCommand(cmd: string): Promise<string> {
          return cmd.trim();
        }
      `;

      const probes = synthesizer.synthesizeForSource(source, "src/command.ts");
      expect(probes.length).toBe(4);
      expect(probes.some((p) => p.vector === "boundary_malformed")).toBe(true);
      expect(probes.some((p) => p.vector === "concurrency_race")).toBe(true);
      expect(probes.some((p) => p.vector === "timeout_latency")).toBe(true);
    });

    it("synthesizes probes for execution context integrating with Gate2Challenger", async () => {
      const targetFilePath = join(srcDir, "data_loader.ts");
      await writeFile(
        targetFilePath,
        `
        export function loadRecord(id: string): Record<string, unknown> {
          if (!id || typeof id !== "string") {
            return {};
          }
          return { id, loaded: true };
        }
        `,
        "utf8"
      );

      const challenger = new Gate2Challenger({
        workspaceRoot: tempDir,
        testDir,
        targetFiles: [targetFilePath],
        attempt: 1,
        maxAttempts: 2,
      });

      // synthesizeDefaultProbes will be called automatically because no probes are explicitly given
      const result = await challenger.run();
      expect(result.success).toBe(true);
      expect(result.verdict).toBe(GATE2_CONSTANTS.VERDICT_PASSED_NO_BREAK);
      expect(result.report.totalProbes).toBeGreaterThan(0);
    });
  });
});
