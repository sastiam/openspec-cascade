/**
 * Gate 0: Fast-Track Policy Bypass Evaluator for Documentation-Only Changes.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 3.6 & Section 2.2.2 (LOOPER-GATE-001)
 * and OpenSpec change `looper-gate0-mechanical-qa` Task 1.3.
 *
 * Fast-Track Policy (Gates 0 & 3): Applied strictly to documentation, typo fixes, and
 * standalone coordination metadata. Gates 1 (Semantic Review) and 2 (Adversarial Challenge)
 * are bypassed; Gate 0 (mechanical checks) and Gate 3 (forensic invariant checks) must pass.
 * Full-Gate Policy (Gates 0, 1, 2, 3): Mandatory for all production source code modifications,
 * architectural changes, cryptographic routines, and PAL adapter implementations.
 */

import { basename, extname } from "node:path";

import {
  GATE0_POLICY_CONSTANTS,
  type Gate0CommandRunner,
  type ResolveGate0EventOptions,
  type GatePolicyEvaluationResult,
  type GatePolicyEvaluationOptions,
  type Gate0PolicyRecommendedEvent,
} from "./gate0_types";
export { GATE0_POLICY_CONSTANTS } from "./gate0_types";
export type { GateExecutionPolicy, GatePolicySelection, Gate0BypassedGate, Gate0RequiredGate, Gate0PolicyRecommendedEvent, GatePolicyEvaluationOptions, GatePolicyEvaluationResult, ResolveGate0EventOptions } from "./gate0_types";


/**
 * Normalizes a raw file path string across Unix and Windows environments.
 */
export function normalizeFilePath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

/**
 * Determines whether a file contains source code, build configs, secrets, or
 * critical files that strictly disqualify it from Fast-Track policy bypass.
 */
export function isDisqualifiedFile(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== "string") {
    return true;
  }

  const normalized = normalizeFilePath(rawPath);
  if (normalized.length === 0) {
    return true;
  }

  const ext = extname(normalized).toLowerCase();
  const lowerBase = basename(normalized).toLowerCase();

  // 1. Any executable programming language file extension
  const disqualifiedExts = new Set<string>(GATE0_POLICY_CONSTANTS.DISQUALIFIED_EXTENSIONS);
  if (disqualifiedExts.has(ext)) {
    return true;
  }

  // 2. Secret and environment files (.env, .env.local, etc.)
  if (lowerBase === ".env" || lowerBase.startsWith(".env.")) {
    return true;
  }

  // 3. Critical build / packaging / compiler configuration files
  const disqualifiedConfigs = new Set<string>(GATE0_POLICY_CONSTANTS.DISQUALIFIED_CONFIG_FILES);
  if (disqualifiedConfigs.has(lowerBase)) {
    return true;
  }

  // 4. Source code and critical workflow directories
  const isInDisqualifiedDir = GATE0_POLICY_CONSTANTS.DISQUALIFIED_DIRECTORIES.some(
    (dir) => normalized.startsWith(dir) || normalized.includes(`/${dir}`),
  );
  if (isInDisqualifiedDir) {
    return true;
  }

  return false;
}

/**
 * Determines whether a file qualifies as documentation, documentation asset,
 * or safe coordination metadata.
 */
export function isDocumentationFile(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== "string") {
    return false;
  }

  const normalized = normalizeFilePath(rawPath);
  if (normalized.length === 0) {
    return false;
  }

  // Any disqualified file immediately invalidates documentation classification
  if (isDisqualifiedFile(normalized)) {
    return false;
  }

  const ext = extname(normalized).toLowerCase();
  const baseStr = basename(normalized);
  const baseWithoutExt = ext ? baseStr.slice(0, -ext.length).toLowerCase() : baseStr.toLowerCase();

  const docExtSet = new Set<string>(GATE0_POLICY_CONSTANTS.DOC_EXTENSIONS);
  const assetExtSet = new Set<string>(GATE0_POLICY_CONSTANTS.DOC_ASSET_EXTENSIONS);
  const metaExtSet = new Set<string>(GATE0_POLICY_CONSTANTS.METADATA_EXTENSIONS);

  // 1. Known documentation file extension (.md, .txt, .rst, .adoc, etc.)
  if (docExtSet.has(ext)) {
    return true;
  }

  // 2. Standard repository root documentation files (README, LICENSE, CHANGELOG, etc.)
  const isRootDocBase = GATE0_POLICY_CONSTANTS.DOC_ROOT_BASENAMES.some(
    (name) =>
      baseWithoutExt === name ||
      baseWithoutExt.startsWith(`${name}.`) ||
      baseWithoutExt.startsWith(`${name}-`) ||
      baseWithoutExt.startsWith(`${name}_`),
  );
  if (isRootDocBase && (ext === "" || docExtSet.has(ext) || ext === ".txt")) {
    return true;
  }

  // 3. Files inside designated documentation or metadata directories
  const isInDocDir = GATE0_POLICY_CONSTANTS.DOC_DIRECTORIES.some(
    (dir) => normalized.startsWith(dir) || normalized.includes(`/${dir}`),
  );
  if (isInDocDir) {
    // Permitted doc assets and coordination metadata inside doc directories
    if (assetExtSet.has(ext) || metaExtSet.has(ext) || docExtSet.has(ext)) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates whether an affected files list qualifies for Fast-Track policy bypass.
 * Fast-track policy (Gates 0 & 3 only) applies strictly to documentation, typo fixes,
 * or non-code documentation files.
 */
export function isFastTrackCandidate(affectedFiles?: readonly string[]): boolean {
  if (!affectedFiles || affectedFiles.length === 0) {
    return false;
  }

  for (const rawPath of affectedFiles) {
    if (!isDocumentationFile(rawPath)) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates Gate Execution Policy based on affected files and requested policy mode.
 *
 * Enforces Provider-Agnostic Multi-Agent Looper Section 3.6:
 * - Fast-Track Policy: Gates 1 & 2 bypassed; Gates 0 & 3 required.
 * - Full-Gate Policy: Gates 0, 1, 2, & 3 required.
 */
export function evaluateGateExecutionPolicy(
  optionsOrFiles?: GatePolicyEvaluationOptions | readonly string[],
): GatePolicyEvaluationResult {
  const options: GatePolicyEvaluationOptions = Array.isArray(optionsOrFiles)
    ? { affectedFiles: optionsOrFiles }
    : ((optionsOrFiles as GatePolicyEvaluationOptions | undefined) ?? {});

  const requestedPolicy = options.policy ?? GATE0_POLICY_CONSTANTS.POLICY_AUTO;
  const allowFastTrack = options.allowFastTrack ?? true;
  const rawFiles = options.affectedFiles ?? [];
  const inspectedFiles = rawFiles
    .map(normalizeFilePath)
    .filter((f) => f.length > 0);

  const candidateFiles: string[] = [];
  const disqualifiedFiles: string[] = [];

  for (const file of inspectedFiles) {
    if (isDocumentationFile(file)) {
      candidateFiles.push(file);
    } else {
      disqualifiedFiles.push(file);
    }
  }

  // 1. Fast-track globally disabled by configuration
  if (!allowFastTrack) {
    return {
      policy: GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE,
      isFastTrack: false,
      bypassedGates: [],
      requiredGates: [
        GATE0_POLICY_CONSTANTS.GATE_0,
        GATE0_POLICY_CONSTANTS.GATE_1,
        GATE0_POLICY_CONSTANTS.GATE_2,
        GATE0_POLICY_CONSTANTS.GATE_3,
      ],
      reason: "Fast-track policy disabled by configuration (allowFastTrack is false). Full-Gate verification required.",
      disqualifiedFiles,
      candidateFiles,
      inspectedFiles,
      recommendedSuccessEvent: GATE0_POLICY_CONSTANTS.EVT_G0_PASS,
    };
  }

  // 2. Explicit Full-Gate policy requested
  if (requestedPolicy === GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE) {
    return {
      policy: GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE,
      isFastTrack: false,
      bypassedGates: [],
      requiredGates: [
        GATE0_POLICY_CONSTANTS.GATE_0,
        GATE0_POLICY_CONSTANTS.GATE_1,
        GATE0_POLICY_CONSTANTS.GATE_2,
        GATE0_POLICY_CONSTANTS.GATE_3,
      ],
      reason: "Explicit Full-Gate policy requested. Mandatory verification across all 4 gates.",
      disqualifiedFiles,
      candidateFiles,
      inspectedFiles,
      recommendedSuccessEvent: GATE0_POLICY_CONSTANTS.EVT_G0_PASS,
    };
  }

  // 3. Explicit Fast-Track policy requested with safety verification
  if (requestedPolicy === GATE0_POLICY_CONSTANTS.POLICY_FAST_TRACK) {
    if (disqualifiedFiles.length > 0) {
      const sample = disqualifiedFiles.slice(0, GATE0_POLICY_CONSTANTS.PREVIEW_FILE_COUNT_LIMIT).join(", ");
      return {
        policy: GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE,
        isFastTrack: false,
        bypassedGates: [],
        requiredGates: [
          GATE0_POLICY_CONSTANTS.GATE_0,
          GATE0_POLICY_CONSTANTS.GATE_1,
          GATE0_POLICY_CONSTANTS.GATE_2,
          GATE0_POLICY_CONSTANTS.GATE_3,
        ],
        reason: `Explicit fast-track policy rejected: ${disqualifiedFiles.length} source code or configuration files detected (${sample}). Full-Gate verification enforced.`,
        disqualifiedFiles,
        candidateFiles,
        inspectedFiles,
        recommendedSuccessEvent: GATE0_POLICY_CONSTANTS.EVT_G0_PASS,
      };
    }

    return {
      policy: GATE0_POLICY_CONSTANTS.POLICY_FAST_TRACK,
      isFastTrack: true,
      bypassedGates: [GATE0_POLICY_CONSTANTS.GATE_1, GATE0_POLICY_CONSTANTS.GATE_2],
      requiredGates: [GATE0_POLICY_CONSTANTS.GATE_0, GATE0_POLICY_CONSTANTS.GATE_3],
      reason: "Explicit Fast-Track policy granted for documentation/metadata changes. Gates 1 and 2 bypassed.",
      disqualifiedFiles: [],
      candidateFiles,
      inspectedFiles,
      recommendedSuccessEvent: GATE0_POLICY_CONSTANTS.EVT_G0_PASS_FAST_TRACK,
    };
  }

  // 4. Heuristic evaluation (POLICY_AUTO)
  if (inspectedFiles.length === 0) {
    return {
      policy: GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE,
      isFastTrack: false,
      bypassedGates: [],
      requiredGates: [
        GATE0_POLICY_CONSTANTS.GATE_0,
        GATE0_POLICY_CONSTANTS.GATE_1,
        GATE0_POLICY_CONSTANTS.GATE_2,
        GATE0_POLICY_CONSTANTS.GATE_3,
      ],
      reason: "No affected files specified; defaulting to Full-Gate policy for safety.",
      disqualifiedFiles: [],
      candidateFiles: [],
      inspectedFiles: [],
      recommendedSuccessEvent: GATE0_POLICY_CONSTANTS.EVT_G0_PASS,
    };
  }

  if (disqualifiedFiles.length > 0) {
    const sample = disqualifiedFiles.slice(0, GATE0_POLICY_CONSTANTS.PREVIEW_FILE_COUNT_LIMIT).join(", ");
    return {
      policy: GATE0_POLICY_CONSTANTS.POLICY_FULL_GATE,
      isFastTrack: false,
      bypassedGates: [],
      requiredGates: [
        GATE0_POLICY_CONSTANTS.GATE_0,
        GATE0_POLICY_CONSTANTS.GATE_1,
        GATE0_POLICY_CONSTANTS.GATE_2,
        GATE0_POLICY_CONSTANTS.GATE_3,
      ],
      reason: `Full-Gate policy required: ${disqualifiedFiles.length} non-documentation / source files detected (${sample}).`,
      disqualifiedFiles,
      candidateFiles,
      inspectedFiles,
      recommendedSuccessEvent: GATE0_POLICY_CONSTANTS.EVT_G0_PASS,
    };
  }

  // All inspected files strictly qualify as documentation or safe metadata
  return {
    policy: GATE0_POLICY_CONSTANTS.POLICY_FAST_TRACK,
    isFastTrack: true,
    bypassedGates: [GATE0_POLICY_CONSTANTS.GATE_1, GATE0_POLICY_CONSTANTS.GATE_2],
    requiredGates: [GATE0_POLICY_CONSTANTS.GATE_0, GATE0_POLICY_CONSTANTS.GATE_3],
    reason: `Fast-Track policy bypass granted: all ${candidateFiles.length} affected files are documentation or safe metadata. Gates 1 and 2 bypassed.`,
    disqualifiedFiles: [],
    candidateFiles,
    inspectedFiles,
    recommendedSuccessEvent: GATE0_POLICY_CONSTANTS.EVT_G0_PASS_FAST_TRACK,
  };
}

/**
 * Resolves the recommended FSM transition event for Gate 0 based on mechanical success,
 * policy determination, and attempt counters.
 */
export function resolveGate0RecommendedEvent(
  options: ResolveGate0EventOptions,
): Gate0PolicyRecommendedEvent {
  const attempt = options.attempt ?? GATE0_POLICY_CONSTANTS.DEFAULT_CURRENT_ATTEMPT;
  const maxAttempts = options.maxAttempts ?? GATE0_POLICY_CONSTANTS.DEFAULT_MAX_ATTEMPTS;

  if (options.success) {
    return options.isFastTrack
      ? GATE0_POLICY_CONSTANTS.EVT_G0_PASS_FAST_TRACK
      : GATE0_POLICY_CONSTANTS.EVT_G0_PASS;
  }

  if (attempt < maxAttempts) {
    return GATE0_POLICY_CONSTANTS.EVT_G0_RETRY;
  }

  return GATE0_POLICY_CONSTANTS.EVT_G0_EXHAUSTED;
}

/**
 * Discovers modified and untracked files from git status output for autonomous policy evaluation.
 */
export async function detectGitAffectedFiles(
  runner?: Gate0CommandRunner,
  cwd: string = process.cwd(),
): Promise<string[]> {
  if (!runner) {
    return [];
  }

  try {
    const res = await runner("git status --porcelain", { cwd });
    if (res.code !== GATE0_POLICY_CONSTANTS.DEFAULT_COMMAND_SUCCESS_EXIT_CODE) {
      return [];
    }

    const lines = res.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    const files: string[] = [];

    for (const line of lines) {
      const match = line.match(/^..\s+(.+)$/);
      if (match && match[1]) {
        let filePath = match[1].trim();
        if (filePath.includes(" -> ")) {
          filePath = filePath.split(" -> ").pop()!.trim();
        }
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.slice(1, -1);
        }
        files.push(normalizeFilePath(filePath));
      }
    }

    return files;
  } catch {
    return [];
  }
}
