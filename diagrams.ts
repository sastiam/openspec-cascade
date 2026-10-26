/**
 * Diagram automation module for openspec-cascade.
 *
 * Automates synchronization and updates of Graphify knowledge graphs and
 * Archify architecture and explainer diagrams upon OpenSpec change completion.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { CONSTANTS } from "./config";
import { defaultCommandRunner, type CommandRunner } from "./qa";

export interface ArchifyTarget {
  name: string;
  candidatePath: string;
  outputPath: string;
  diagramType: string;
  quality: string;
}

export interface BuildArchifyCommandOptions {
  bin?: string;
  action?: string;
  target: ArchifyTarget;
}

export interface DiagramStepResult {
  tool: "graphify" | "archify";
  target?: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  success: boolean;
}

export interface DiagramSyncResult {
  success: boolean;
  graphify?: DiagramStepResult;
  archify: DiagramStepResult[];
}

export interface DiagramSyncOptions {
  /** Target repository root directory. Defaults to process.cwd() */
  cwd?: string;
  /** Custom command for Graphify update. Defaults to CONSTANTS.GRAPHIFY_COMMAND ("graphify update .") */
  graphifyCommand?: string;
  /** Custom executable or command prefix for Archify. Defaults to auto-detected archify */
  archifyBin?: string;
  /** Action for Archify CLI rendering (e.g. "deliver" or "render"). Defaults to CONSTANTS.ARCHIFY_ACTION */
  archifyAction?: string;
  /** Quality profile override for Archify rendering */
  archifyQuality?: string;
  /** Whether to run Graphify update. Defaults to true */
  runGraphify?: boolean;
  /** Whether to run Archify rendering. Defaults to true */
  runArchify?: boolean;
  /** Execution timeout per command in ms */
  timeoutMs?: number;
  /** Whether to throw an Error on sync failure instead of returning result. Defaults to false */
  throwOnError?: boolean;
  /** Custom runner for executing commands, enabling dependency injection for testing. */
  runner?: CommandRunner;
  /** Hooks for progress and event logging. */
  hooks?: {
    say?: (message: string) => void;
    log?: (event: string, data: Record<string, unknown>) => void;
  };
}

export function discoverArchifyTargets(repoDir: string): ArchifyTarget[] {
  const archifyDir = join(repoDir, CONSTANTS.ARCHIFY_DIR_NAME);
  if (!existsSync(archifyDir)) return [];

  const targets: ArchifyTarget[] = [];

  try {
    const entries = readdirSync(archifyDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const subDir = join(archifyDir, entry.name);
      const jsonCandidate = join(subDir, CONSTANTS.ARCHIFY_CANDIDATE_JSON);
      const mdCandidate = join(subDir, CONSTANTS.ARCHIFY_CANDIDATE_MD);

      if (existsSync(jsonCandidate)) {
        try {
          const raw = readFileSync(jsonCandidate, "utf-8");
          const parsed = JSON.parse(raw);
          const diagramType =
            typeof parsed.diagram_type === "string"
              ? parsed.diagram_type
              : typeof parsed.type === "string"
                ? parsed.type
                : CONSTANTS.ARCHIFY_DEFAULT_TYPE;
          const outputName =
            typeof parsed.meta?.output === "string"
              ? parsed.meta.output
              : `${entry.name}${CONSTANTS.ARCHIFY_FALLBACK_EXT}`;
          const outputPath = isAbsolute(outputName) ? outputName : join(subDir, outputName);
          const quality =
            typeof parsed.meta?.quality_profile === "string"
              ? parsed.meta.quality_profile
              : CONSTANTS.ARCHIFY_DEFAULT_QUALITY;

          targets.push({
            name: entry.name,
            candidatePath: jsonCandidate,
            outputPath,
            diagramType,
            quality,
          });
        } catch {
          // ignore corrupted or unparseable JSON candidate
        }
      } else if (existsSync(mdCandidate)) {
        targets.push({
          name: entry.name,
          candidatePath: mdCandidate,
          outputPath: join(subDir, `${entry.name}${CONSTANTS.ARCHIFY_FALLBACK_EXT}`),
          diagramType: CONSTANTS.ARCHIFY_EXPLAINER_TYPE,
          quality: CONSTANTS.ARCHIFY_DEFAULT_QUALITY,
        });
      }
    }

    const rootCandidate = join(archifyDir, CONSTANTS.ARCHIFY_CANDIDATE_JSON);
    if (existsSync(rootCandidate)) {
      try {
        const raw = readFileSync(rootCandidate, "utf-8");
        const parsed = JSON.parse(raw);
        const diagramType =
          typeof parsed.diagram_type === "string"
            ? parsed.diagram_type
            : typeof parsed.type === "string"
              ? parsed.type
              : CONSTANTS.ARCHIFY_DEFAULT_TYPE;
        const outputName =
          typeof parsed.meta?.output === "string"
            ? parsed.meta.output
            : `${CONSTANTS.ARCHIFY_DEFAULT_TYPE}${CONSTANTS.ARCHIFY_FALLBACK_EXT}`;
        const outputPath = isAbsolute(outputName) ? outputName : join(archifyDir, outputName);
        const quality =
          typeof parsed.meta?.quality_profile === "string"
            ? parsed.meta.quality_profile
            : CONSTANTS.ARCHIFY_DEFAULT_QUALITY;

        targets.push({
          name: "root",
          candidatePath: rootCandidate,
          outputPath,
          diagramType,
          quality,
        });
      } catch {
        // ignore corrupted root candidate
      }
    }
  } catch {
    return [];
  }

  return targets;
}

export function resolveArchifyBin(customBin?: string): string {
  if (customBin && customBin.trim()) return customBin.trim();
  if (process.env.ARCHIFY_BIN && process.env.ARCHIFY_BIN.trim()) {
    return process.env.ARCHIFY_BIN.trim();
  }
  if (process.env.CASCADE_ARCHIFY_BIN && process.env.CASCADE_ARCHIFY_BIN.trim()) {
    return process.env.CASCADE_ARCHIFY_BIN.trim();
  }

  const inPath = Bun.which("archify");
  if (inPath) return inPath;

  const home = homedir();
  const hermesScript = join(home, ".hermes", "skills", "archify", "bin", "archify.mjs");
  if (existsSync(hermesScript)) {
    return `node "${hermesScript}"`;
  }

  const localBin = join(home, ".local", "bin", "archify");
  if (existsSync(localBin)) {
    return localBin;
  }

  return "archify";
}

export function buildArchifyCommand(options: BuildArchifyCommandOptions): string {
  const bin = resolveArchifyBin(options.bin);
  const action = options.action ?? CONSTANTS.ARCHIFY_ACTION;
  const quality = options.target.quality || CONSTANTS.ARCHIFY_DEFAULT_QUALITY;

  if (action === "render") {
    return `${bin} render ${options.target.diagramType} "${options.target.candidatePath}" "${options.target.outputPath}" --quality ${quality}`;
  }

  return `${bin} ${action} ${options.target.diagramType} "${options.target.candidatePath}" "${options.target.outputPath}" --quality ${quality} --json`;
}

export async function syncDiagrams(options: DiagramSyncOptions = {}): Promise<DiagramSyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const runGraphify = options.runGraphify ?? true;
  const runArchify = options.runArchify ?? true;
  const graphifyCommand = options.graphifyCommand ?? CONSTANTS.GRAPHIFY_COMMAND;
  const archifyAction = options.archifyAction ?? CONSTANTS.ARCHIFY_ACTION;
  const timeoutMs = options.timeoutMs ?? CONSTANTS.DIAGRAM_SYNC_TIMEOUT_MS;
  const runner = options.runner ?? defaultCommandRunner;
  const say = options.hooks?.say;
  const log = options.hooks?.log;

  let graphifyResult: DiagramStepResult | undefined;
  const archifyResults: DiagramStepResult[] = [];
  let overallSuccess = true;

  // 1. Graphify knowledge graph synchronization
  if (runGraphify) {
    say?.("  diagrams: updating Graphify knowledge graph (graphify update .)...");
    const res = await runner(graphifyCommand, cwd, timeoutMs);
    const success = res.code === CONSTANTS.EXIT_CODE_SUCCESS;
    if (!success) {
      overallSuccess = false;
    }
    log?.("diagram_sync", { tool: "graphify", command: graphifyCommand, code: res.code });
    say?.(`  ${success ? "✅" : "❌"} Graphify update (exit ${res.code})`);

    graphifyResult = {
      tool: "graphify",
      command: graphifyCommand,
      exitCode: res.code,
      stdout: res.stdout,
      stderr: res.stderr,
      output: res.output,
      success,
    };
  }

  // 2. Archify diagram rendering
  if (runArchify) {
    const targets = discoverArchifyTargets(cwd);
    if (targets.length === 0) {
      log?.("diagram_sync", { tool: "archify", status: "no_targets" });
    } else {
      for (const target of targets) {
        say?.(`  diagrams: rendering Archify diagram (${target.name})...`);
        const command = buildArchifyCommand({
          bin: options.archifyBin,
          action: archifyAction,
          target: options.archifyQuality ? { ...target, quality: options.archifyQuality } : target,
        });
        const res = await runner(command, cwd, timeoutMs);
        const success = res.code === CONSTANTS.EXIT_CODE_SUCCESS;
        if (!success) {
          overallSuccess = false;
        }
        log?.("diagram_sync", { tool: "archify", target: target.name, command, code: res.code });
        say?.(`  ${success ? "✅" : "❌"} Archify ${target.name} (exit ${res.code})`);

        archifyResults.push({
          tool: "archify",
          target: target.name,
          command,
          exitCode: res.code,
          stdout: res.stdout,
          stderr: res.stderr,
          output: res.output,
          success,
        });
      }
    }
  }

  const result: DiagramSyncResult = {
    success: overallSuccess,
    graphify: graphifyResult,
    archify: archifyResults,
  };

  if (!overallSuccess && options.throwOnError) {
    throw new Error("Diagram synchronization failed");
  }

  return result;
}
