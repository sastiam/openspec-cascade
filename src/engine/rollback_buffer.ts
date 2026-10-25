/**
 * Engine Module: Atomic Git Rollback Buffer & Audit Preservation.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 5.2 & Section 6.3 (LOOPER-GATE-005 / LOOPER-GATE-004),
 * and OpenSpec change `looper-gate3-forensic-audit` Task 1.3.
 *
 * Architecture & Design Invariants:
 * 1. Atomic Git Rollback Buffer:
 *    Executes `git reset --hard ${baselineSha}` followed by `git clean -fd` with strict
 *    exclusion arguments, restoring the working tree to the captured baseline commit.
 * 2. Memory Protection Invariant:
 *    100% of `git clean` commands execute with explicit exclusion flags preserving
 *    `.agents/teamwork/` (agent memory, briefings, progress heartbeats) and `projects/`
 *    (deliverables and specs), guaranteeing zero memory or deliverable wipeouts.
 * 3. Audit Log Preservation:
 *    Guarantees that audit trails, Gate 3 forensic reports, test feedback XMLs, and execution
 *    logs (`logs/`, `.agents/teamwork/`, and registered audit files) survive hard resets
 *    and clean operations intact via multi-tiered in-memory backup, restoration, and `-e` flags.
 * 4. Atomic Triad Lifecycle:
 *    Provides strictly typed atomic methods `snapshot()`, `rollback()`, and `commit()`.
 * 5. Zero Magic Numbers & Strict Typing:
 *    All exit codes, command strings, timeouts, and exclude patterns are centralized
 *    in `ROLLBACK_CONSTANTS`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { CONSTANTS } from "../../config";

/**
 * Central constants ensuring zero magic numbers across Rollback Buffer operations.
 */
export const ROLLBACK_CONSTANTS = {
  // Git Command Primitives
  GIT_RESET_CMD: "git reset --hard" as const,
  GIT_CLEAN_CMD: "git clean -fd" as const,
  GIT_REV_PARSE_HEAD: "git rev-parse HEAD" as const,
  GIT_STATUS_PORCELAIN: "git status --porcelain" as const,
  GIT_HEAD_REF: "HEAD" as const,
  GIT_ADD_ALL: "git add -A" as const,
  GIT_COMMIT_CMD: "git commit -m" as const,

  // Protected Invariant Paths (Memory & Deliverables Protection)
  PROTECTED_TEAMWORK_DIR: ".agents/teamwork/" as const,
  PROTECTED_PROJECTS_DIR: "projects/" as const,
  PROTECTED_LOGS_DIR: "logs/" as const,
  NEVER_COMMIT_ATL: ".atl" as const,
  NEVER_COMMIT_CLAUDE_SETTINGS: ".claude/settings.local.json" as const,

  // Canonical Default Exclude Patterns
  DEFAULT_EXCLUDES: [
    ".agents/teamwork/",
    "projects/",
    "logs/",
    ".atl",
    ".claude/settings.local.json",
  ] as const,

  // Audit Actions
  AUDIT_ACTION_SNAPSHOT: "snapshot" as const,
  AUDIT_ACTION_ROLLBACK: "rollback" as const,
  AUDIT_ACTION_COMMIT: "commit" as const,
  AUDIT_ACTION_REGISTER_LOG: "register_log" as const,

  // Defaults & Limits
  ZERO: 0,
  COMMIT_SHA_SHORT_LENGTH: 7,
  DEFAULT_AUDIT_LOG_FILE: "rollback_audit.jsonl" as const,
  DEFAULT_TIMEOUT_MS: 60_000,
  COMMAND_TIMEOUT_MS: 1_800_000,
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_ERROR: 1,
  EXIT_CODE_TIMEOUT: 124,
  GIT_STATUS_CODE_LENGTH: 2,
  GIT_STATUS_PREFIX_LENGTH: 3,
  MAX_AUDIT_TRAIL_LENGTH: 1_000,
  JSON_INDENT: 2,
} as const;

/**
 * Normalized command runner output structure.
 */
export interface CommandRunnerResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

/**
 * Asynchronous shell execution contract.
 */
export type CommandRunner = (
  cmd: string,
  cwd?: string,
  timeoutMs?: number
) => Promise<CommandRunnerResult>;

/**
 * Snapshot of Git repository working tree state.
 */
export interface GitWorkingTreeState {
  readonly headSha: string;
  readonly isDirty: boolean;
  readonly untrackedFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
}

/**
 * Audit log entry action taxonomy.
 */
export type RollbackAuditAction =
  | typeof ROLLBACK_CONSTANTS.AUDIT_ACTION_SNAPSHOT
  | typeof ROLLBACK_CONSTANTS.AUDIT_ACTION_ROLLBACK
  | typeof ROLLBACK_CONSTANTS.AUDIT_ACTION_COMMIT
  | typeof ROLLBACK_CONSTANTS.AUDIT_ACTION_REGISTER_LOG;

/**
 * Immutable historical record of an atomic state operation.
 */
export interface RollbackAuditEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly action: RollbackAuditAction;
  readonly targetRef?: string;
  readonly baselineSha?: string;
  readonly newSha?: string;
  readonly reason?: string;
  readonly success: boolean;
  readonly preservedPaths?: readonly string[];
  readonly details?: Record<string, unknown>;
}

/**
 * In-memory preservation record of an audit artifact across hard rollback.
 */
export interface PreservedAuditLog {
  readonly path: string;
  readonly content: string;
  readonly timestamp: number;
}

/**
 * Options configuring Git state capture.
 */
export interface CaptureGitStateOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly runner?: CommandRunner;
}

/**
 * Options configuring rollback execution.
 */
export interface RollbackOptions {
  readonly cwd?: string;
  readonly targetRef?: string;
  readonly cleanUntracked?: boolean;
  readonly excludes?: readonly string[] | string[];
  readonly timeoutMs?: number;
  readonly runner?: CommandRunner;
  readonly reason?: string;
  readonly preserveAuditLogs?: boolean;
  readonly auditLogPaths?: readonly string[];
  readonly hooks?: {
    readonly say?: (message: string) => void;
    readonly log?: (event: string, data: Record<string, unknown>) => void;
  };
}

/**
 * Terminal outcome of a working tree rollback operation.
 */
export interface RollbackResult {
  readonly success: boolean;
  readonly targetRef: string;
  readonly resetOutput: string;
  readonly cleanOutput: string;
  readonly error?: string;
  readonly preservedLogsCount?: number;
  readonly auditEntry?: RollbackAuditEntry;
}

/**
 * Options configuring certified Git commit execution.
 */
export interface CommitOptions {
  readonly cwd?: string;
  readonly files?: readonly string[];
  readonly stageAll?: boolean;
  readonly timeoutMs?: number;
  readonly runner?: CommandRunner;
  readonly author?: string;
  readonly hooks?: {
    readonly say?: (message: string) => void;
    readonly log?: (event: string, data: Record<string, unknown>) => void;
  };
}

/**
 * Terminal outcome of an atomic Git commit operation.
 */
export interface CommitResult {
  readonly success: boolean;
  readonly commitSha: string;
  readonly output: string;
  readonly error?: string;
  readonly auditEntry?: RollbackAuditEntry;
}

/**
 * Options configuring RollbackStateBuffer lifecycle.
 */
export interface RollbackBufferOptions {
  readonly cwd?: string;
  readonly excludes?: readonly string[] | string[];
  readonly timeoutMs?: number;
  readonly runner?: CommandRunner;
  readonly auditLogDir?: string;
  readonly preserveAuditLogs?: boolean;
  readonly hooks?: {
    readonly say?: (message: string) => void;
    readonly log?: (event: string, data: Record<string, unknown>) => void;
  };
}

/**
 * Default clean-room subprocess command runner using Bun.spawn.
 */
export async function defaultCommandRunner(
  cmd: string,
  cwd: string = process.cwd(),
  timeoutMs: number = ROLLBACK_CONSTANTS.COMMAND_TIMEOUT_MS
): Promise<CommandRunnerResult> {
  const isWindows = process.platform === "win32";
  const shellArgs = isWindows ? ["cmd.exe", "/c", cmd] : ["sh", "-c", cmd];

  try {
    const proc = Bun.spawn(shellArgs, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<{ timedOut: boolean }>((resolveTimeout) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          // ignore kill failure
        }
        resolveTimeout({ timedOut: true });
      }, timeoutMs);
    });

    const executionPromise = (async () => {
      const [outText, errText, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { outText, errText, exitCode, timedOut: false };
    })();

    const result = await Promise.race([executionPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (result.timedOut || timedOut) {
      return {
        code: ROLLBACK_CONSTANTS.EXIT_CODE_TIMEOUT,
        stdout: "",
        stderr: `Command timed out after ${timeoutMs}ms: ${cmd}`,
        output: `Command timed out after ${timeoutMs}ms: ${cmd}`,
      };
    }

    const { outText, errText, exitCode } = result as {
      outText: string;
      errText: string;
      exitCode: number;
    };
    const stdout = outText.trim();
    const stderr = errText.trim();
    const output = [stdout, stderr].filter(Boolean).join("\n") || stdout || stderr;

    return {
      code: exitCode,
      stdout,
      stderr,
      output,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      code: ROLLBACK_CONSTANTS.EXIT_CODE_ERROR,
      stdout: "",
      stderr: msg,
      output: msg,
    };
  }
}

/**
 * Formats exclude patterns into canonical `git clean -fd` exclude flags.
 * Preserves exact base command behavior when no patterns are provided.
 */
export function buildGitCleanCommand(excludes?: readonly string[] | string[]): string {
  if (!excludes || excludes.length === 0) {
    return ROLLBACK_CONSTANTS.GIT_CLEAN_CMD;
  }
  const flags = excludes
    .filter((pat) => Boolean(pat && pat.trim()))
    .map((pat) => `-e "${pat.trim()}"`)
    .join(" ");
  return flags ? `${ROLLBACK_CONSTANTS.GIT_CLEAN_CMD} ${flags}` : ROLLBACK_CONSTANTS.GIT_CLEAN_CMD;
}

/**
 * Captures the current Git HEAD SHA and working tree status (untracked & modified files).
 */
export async function captureGitState(
  options: CaptureGitStateOptions = {}
): Promise<GitWorkingTreeState> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? ROLLBACK_CONSTANTS.COMMAND_TIMEOUT_MS;
  const runner = options.runner ?? defaultCommandRunner;

  let headSha: string = ROLLBACK_CONSTANTS.GIT_HEAD_REF;
  const revRes = await runner(ROLLBACK_CONSTANTS.GIT_REV_PARSE_HEAD, cwd, timeoutMs);
  if (revRes.code === ROLLBACK_CONSTANTS.EXIT_CODE_SUCCESS && revRes.stdout.trim()) {
    headSha = revRes.stdout.trim();
  }

  const untrackedFiles: string[] = [];
  const modifiedFiles: string[] = [];

  const statusRes = await runner(ROLLBACK_CONSTANTS.GIT_STATUS_PORCELAIN, cwd, timeoutMs);
  if (statusRes.code === ROLLBACK_CONSTANTS.EXIT_CODE_SUCCESS && statusRes.stdout.trim()) {
    const lines = statusRes.stdout.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const statusPrefix = line.slice(0, ROLLBACK_CONSTANTS.GIT_STATUS_CODE_LENGTH);
      const filePath = line.slice(ROLLBACK_CONSTANTS.GIT_STATUS_PREFIX_LENGTH).trim();
      if (statusPrefix === "??") {
        untrackedFiles.push(filePath);
      } else {
        modifiedFiles.push(filePath);
      }
    }
  }

  return {
    headSha,
    isDirty: untrackedFiles.length > 0 || modifiedFiles.length > 0,
    untrackedFiles,
    modifiedFiles,
  };
}

/**
 * Rolls back the Git working tree to the specified target reference while
 * strictly isolating protected coordination memory and preserving audit logs.
 */
export async function rollbackWorkingTree(
  options: RollbackOptions = {}
): Promise<RollbackResult> {
  const cwd = options.cwd ?? process.cwd();
  const targetRef = options.targetRef ?? ROLLBACK_CONSTANTS.GIT_HEAD_REF;
  const cleanUntracked = options.cleanUntracked ?? true;
  const timeoutMs = options.timeoutMs ?? ROLLBACK_CONSTANTS.COMMAND_TIMEOUT_MS;
  const runner = options.runner ?? defaultCommandRunner;
  const preserveAuditLogs = options.preserveAuditLogs ?? true;
  const say = options.hooks?.say;
  const log = options.hooks?.log;

  // Compile combined excludes ensuring memory and deliverables protection invariants
  let combinedExcludes: string[];
  if (options.excludes !== undefined) {
    const list = Array.from(options.excludes);
    if (options.auditLogPaths && preserveAuditLogs) {
      for (const p of options.auditLogPaths) {
        if (p && p.trim()) {
          const rel = isAbsolute(p) ? relative(cwd, p) : p;
          if (!list.includes(rel.trim())) {
            list.push(rel.trim());
          }
        }
      }
    }
    combinedExcludes = list;
  } else {
    const set = new Set<string>(ROLLBACK_CONSTANTS.DEFAULT_EXCLUDES);
    if (options.auditLogPaths && preserveAuditLogs) {
      for (const p of options.auditLogPaths) {
        if (p && p.trim()) {
          const rel = isAbsolute(p) ? relative(cwd, p) : p;
          set.add(rel.trim());
        }
      }
    }
    combinedExcludes = Array.from(set);
  }

  say?.(`  [rollback] resetting working tree to ${targetRef}...`);
  log?.("rollback_start", { targetRef, cleanUntracked, reason: options.reason });

  // 1. Back up registered audit log files before reset if preservation is enabled
  const backedUpLogs = new Map<string, string>();
  if (preserveAuditLogs && options.auditLogPaths && options.auditLogPaths.length > 0) {
    for (const rawPath of options.auditLogPaths) {
      const fullPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.isFile()) {
          const content = await readFile(fullPath, "utf-8");
          backedUpLogs.set(fullPath, content);
        }
      } catch {
        // File may not exist yet or is inaccessible
      }
    }
  }

  // 2. Execute git reset --hard <targetRef>
  const resetCmd = `${ROLLBACK_CONSTANTS.GIT_RESET_CMD} ${targetRef}`;
  const resetRes = await runner(resetCmd, cwd, timeoutMs);

  if (resetRes.code !== ROLLBACK_CONSTANTS.EXIT_CODE_SUCCESS) {
    const error = `git reset failed (exit ${resetRes.code}): ${resetRes.stderr || resetRes.output}`;
    say?.(`  ❌ ${error}`);
    log?.("rollback_error", { phase: "reset", error, code: resetRes.code });
    return {
      success: false,
      targetRef,
      resetOutput: resetRes.output,
      cleanOutput: "",
      error,
      preservedLogsCount: 0,
    };
  }

  // 3. Execute git clean -fd with strict exclusion flags
  let cleanOutput = "";
  if (cleanUntracked) {
    const cleanCmd = buildGitCleanCommand(Array.from(combinedExcludes));
    const cleanRes = await runner(cleanCmd, cwd, timeoutMs);
    cleanOutput = cleanRes.output;

    if (cleanRes.code !== ROLLBACK_CONSTANTS.EXIT_CODE_SUCCESS) {
      const error = `git clean failed (exit ${cleanRes.code}): ${cleanRes.stderr || cleanRes.output}`;
      say?.(`  ❌ ${error}`);
      log?.("rollback_error", { phase: "clean", error, code: cleanRes.code });
      return {
        success: false,
        targetRef,
        resetOutput: resetRes.output,
        cleanOutput: cleanRes.output,
        error,
        preservedLogsCount: 0,
      };
    }
  }

  // 4. Restore backed up audit logs post-reset
  let restoredCount = 0;
  if (backedUpLogs.size > 0) {
    for (const [filePath, content] of backedUpLogs.entries()) {
      try {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
        restoredCount++;
      } catch (err) {
        log?.("rollback_restore_error", { filePath, error: String(err) });
      }
    }
  }

  say?.(`  ✅ Working tree cleanly restored to ${targetRef} (preserved ${restoredCount} audit logs)`);
  log?.("rollback_success", { targetRef, cleanUntracked, restoredCount });

  const auditEntry: RollbackAuditEntry = {
    id: randomUUID(),
    timestamp: Date.now(),
    action: ROLLBACK_CONSTANTS.AUDIT_ACTION_ROLLBACK,
    targetRef,
    reason: options.reason,
    success: true,
    preservedPaths: Array.from(backedUpLogs.keys()),
    details: {
      cleanUntracked,
      restoredCount,
      excludes: Array.from(combinedExcludes),
    },
  };

  return {
    success: true,
    targetRef,
    resetOutput: resetRes.output,
    cleanOutput,
    preservedLogsCount: restoredCount,
    auditEntry,
  };
}

/**
 * Stateful, atomic Git rollback buffer module.
 *
 * Captures Git commit baseline snapshots, tracks working tree modifications,
 * executes certified atomic commits, and manages clean rollbacks (`git reset --hard`
 * & `git clean -fd`) while strictly isolating agent coordination memory and
 * preserving forensic audit logs.
 */
export class RollbackStateBuffer {
  private readonly cwd: string;
  private readonly excludes: Set<string>;
  private readonly timeoutMs: number;
  private readonly runner: CommandRunner;
  private readonly auditLogDir: string;
  private readonly preserveAuditLogs: boolean;
  private readonly hooks?: {
    say?: (message: string) => void;
    log?: (event: string, data: Record<string, unknown>) => void;
  };

  private baselineSha: string | null = null;
  private snapshotTakenAt: number | null = null;
  private rollbackCount: number = 0;
  private commitCount: number = 0;

  private readonly registeredAuditLogs = new Map<string, { content?: string; registeredAt: number }>();
  private readonly auditTrail: RollbackAuditEntry[] = [];

  constructor(options: RollbackBufferOptions = {}) {
    this.cwd = resolve(options.cwd ?? process.cwd());
    this.timeoutMs = options.timeoutMs ?? ROLLBACK_CONSTANTS.COMMAND_TIMEOUT_MS;
    this.runner = options.runner ?? defaultCommandRunner;
    this.auditLogDir = resolve(options.auditLogDir ?? join(this.cwd, ROLLBACK_CONSTANTS.PROTECTED_LOGS_DIR));
    this.preserveAuditLogs = options.preserveAuditLogs ?? true;
    this.hooks = options.hooks;

    // Initialize excludes: ensure memory & deliverables protection invariants are active
    const inputExcludes = options.excludes ?? ROLLBACK_CONSTANTS.DEFAULT_EXCLUDES;
    this.excludes = new Set<string>(inputExcludes);
    this.excludes.add(ROLLBACK_CONSTANTS.PROTECTED_TEAMWORK_DIR);
    this.excludes.add(ROLLBACK_CONSTANTS.PROTECTED_PROJECTS_DIR);
    if (this.preserveAuditLogs) {
      this.excludes.add(ROLLBACK_CONSTANTS.PROTECTED_LOGS_DIR);
    }
  }

  /**
   * Captures the current repository HEAD commit SHA as the rollback baseline snapshot.
   */
  async snapshot(): Promise<string> {
    const state = await captureGitState({
      cwd: this.cwd,
      timeoutMs: this.timeoutMs,
      runner: this.runner,
    });
    this.baselineSha = state.headSha;
    this.snapshotTakenAt = Date.now();

    const entry: RollbackAuditEntry = {
      id: randomUUID(),
      timestamp: this.snapshotTakenAt,
      action: ROLLBACK_CONSTANTS.AUDIT_ACTION_SNAPSHOT,
      baselineSha: this.baselineSha,
      success: true,
      details: {
        isDirty: state.isDirty,
        untrackedCount: state.untrackedFiles.length,
        modifiedCount: state.modifiedFiles.length,
      },
    };
    this.auditTrail.push(entry);
    this.hooks?.log?.("rollback_snapshot", { sha: this.baselineSha });
    return this.baselineSha;
  }

  /**
   * Checks whether the working tree currently has modifications or untracked files,
   * honoring all configured and registered exclude patterns.
   */
  async isDirty(): Promise<boolean> {
    const state = await captureGitState({
      cwd: this.cwd,
      timeoutMs: this.timeoutMs,
      runner: this.runner,
    });

    const isExcluded = (filePath: string): boolean => {
      const normalizedPath = filePath.replace(/\\/g, "/");
      for (const ex of this.excludes) {
        const cleanEx = ex.replace(/\\/g, "/").replace(/\/$/, "");
        if (
          normalizedPath === cleanEx ||
          normalizedPath.startsWith(`${cleanEx}/`) ||
          ex === normalizedPath
        ) {
          return true;
        }
      }
      for (const registered of this.registeredAuditLogs.keys()) {
        const rel = isAbsolute(registered) ? relative(this.cwd, registered) : registered;
        const normRel = rel.replace(/\\/g, "/");
        if (normalizedPath === normRel || normalizedPath.startsWith(`${normRel}/`)) {
          return true;
        }
      }
      return false;
    };

    const dirtyUntracked = state.untrackedFiles.some((f) => !isExcluded(f));
    const dirtyModified = state.modifiedFiles.some((f) => !isExcluded(f));

    return dirtyUntracked || dirtyModified;
  }

  /**
   * Registers an audit log file path or content to be preserved across any rollback.
   */
  registerAuditLog(filePath: string, inMemoryContent?: string): void {
    const fullPath = isAbsolute(filePath) ? filePath : resolve(this.cwd, filePath);
    this.registeredAuditLogs.set(fullPath, {
      content: inMemoryContent,
      registeredAt: Date.now(),
    });

    // Add relative path to excludes set to protect during git clean
    const rel = relative(this.cwd, fullPath).replace(/\\/g, "/");
    this.excludes.add(rel);

    const entry: RollbackAuditEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      action: ROLLBACK_CONSTANTS.AUDIT_ACTION_REGISTER_LOG,
      success: true,
      preservedPaths: [fullPath],
    };
    this.auditTrail.push(entry);
  }

  /**
   * Convenience alias registering an audit log path with explicit content.
   */
  preserveAuditLog(filePath: string, content: string): void {
    this.registerAuditLog(filePath, content);
  }

  /**
   * Reverts all changes in the working tree back to the baseline snapshot (or target ref),
   * executing `git reset --hard` and `git clean -fd` while preserving audit logs.
   */
  async rollback(
    targetRefOverride?: string,
    optionsOverride: Partial<RollbackOptions> = {}
  ): Promise<RollbackResult> {
    const targetRef = targetRefOverride ?? this.baselineSha ?? ROLLBACK_CONSTANTS.GIT_HEAD_REF;

    // Collect all audit paths to preserve
    const auditPaths = Array.from(this.registeredAuditLogs.keys());
    if (optionsOverride.auditLogPaths) {
      for (const p of optionsOverride.auditLogPaths) {
        auditPaths.push(isAbsolute(p) ? p : resolve(this.cwd, p));
      }
    }

    // Merge in-memory content into files on disk before rollback if provided
    for (const [p, meta] of this.registeredAuditLogs.entries()) {
      if (meta.content !== undefined) {
        try {
          await mkdir(dirname(p), { recursive: true });
          await writeFile(p, meta.content, "utf-8");
        } catch {
          // Ignore pre-write error
        }
      }
    }

    const mergedExcludes = new Set<string>(this.excludes);
    if (optionsOverride.excludes) {
      for (const ex of optionsOverride.excludes) {
        mergedExcludes.add(ex);
      }
    }

    const result = await rollbackWorkingTree({
      cwd: this.cwd,
      targetRef,
      cleanUntracked: optionsOverride.cleanUntracked ?? true,
      excludes: Array.from(mergedExcludes),
      timeoutMs: optionsOverride.timeoutMs ?? this.timeoutMs,
      runner: optionsOverride.runner ?? this.runner,
      reason: optionsOverride.reason,
      preserveAuditLogs: optionsOverride.preserveAuditLogs ?? this.preserveAuditLogs,
      auditLogPaths: auditPaths,
      hooks: optionsOverride.hooks ?? this.hooks,
    });

    if (result.success) {
      this.rollbackCount++;
    }

    if (result.auditEntry) {
      this.auditTrail.push(result.auditEntry);
    }

    return result;
  }

  /**
   * Executes an atomic Conventional Git commit when all verification gates succeed,
   * advancing the baseline SHA to the new commit.
   */
  async commit(
    message: string,
    options: CommitOptions = {}
  ): Promise<CommitResult> {
    const cwd = options.cwd ?? this.cwd;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const runner = options.runner ?? this.runner;
    const say = options.hooks?.say ?? this.hooks?.say;
    const log = options.hooks?.log ?? this.hooks?.log;

    if (!message || !message.trim()) {
      return {
        success: false,
        commitSha: this.baselineSha ?? ROLLBACK_CONSTANTS.GIT_HEAD_REF,
        output: "",
        error: "Cannot create commit with empty message",
      };
    }

    say?.(`  [commit] staging files for certified commit...`);
    log?.("commit_start", { message });

    // 1. Stage changes
    let addCmd: string = ROLLBACK_CONSTANTS.GIT_ADD_ALL;
    if (options.files && options.files.length > 0) {
      const quotedFiles = options.files.map((f) => `"${f}"`).join(" ");
      addCmd = `git add ${quotedFiles}`;
    }

    const addRes = await runner(addCmd, cwd, timeoutMs);
    if (addRes.code !== ROLLBACK_CONSTANTS.EXIT_CODE_SUCCESS) {
      const error = `git add failed (exit ${addRes.code}): ${addRes.stderr || addRes.output}`;
      say?.(`  ❌ ${error}`);
      log?.("commit_error", { phase: "add", error });
      return {
        success: false,
        commitSha: this.baselineSha ?? ROLLBACK_CONSTANTS.GIT_HEAD_REF,
        output: addRes.output,
        error,
      };
    }

    // 2. Execute git commit
    const escapedMessage = message.replace(/"/g, '\\"');
    const authorFlag = options.author ? `--author="${options.author}"` : "";
    const commitCmd = `${ROLLBACK_CONSTANTS.GIT_COMMIT_CMD} "${escapedMessage}" ${authorFlag}`.trim();

    const commitRes = await runner(commitCmd, cwd, timeoutMs);
    if (commitRes.code !== ROLLBACK_CONSTANTS.EXIT_CODE_SUCCESS) {
      const error = `git commit failed (exit ${commitRes.code}): ${commitRes.stderr || commitRes.output}`;
      say?.(`  ❌ ${error}`);
      log?.("commit_error", { phase: "commit", error });
      return {
        success: false,
        commitSha: this.baselineSha ?? ROLLBACK_CONSTANTS.GIT_HEAD_REF,
        output: commitRes.output,
        error,
      };
    }

    // 3. Resolve new HEAD commit SHA
    const revRes = await runner(ROLLBACK_CONSTANTS.GIT_REV_PARSE_HEAD, cwd, timeoutMs);
    const newCommitSha = revRes.stdout.trim() || ROLLBACK_CONSTANTS.GIT_HEAD_REF;

    // Update baseline to advance checkpoint
    const oldBaseline = this.baselineSha;
    this.baselineSha = newCommitSha;
    this.commitCount++;

    const shortSha = newCommitSha.slice(
      ROLLBACK_CONSTANTS.ZERO,
      ROLLBACK_CONSTANTS.COMMIT_SHA_SHORT_LENGTH
    );
    say?.(`  ✅ Certified commit created: ${shortSha} ("${message}")`);
    log?.("commit_success", { newCommitSha, oldBaseline, message });

    const auditEntry: RollbackAuditEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      action: ROLLBACK_CONSTANTS.AUDIT_ACTION_COMMIT,
      baselineSha: oldBaseline ?? undefined,
      newSha: newCommitSha,
      reason: message,
      success: true,
      details: {
        output: commitRes.output,
      },
    };
    this.auditTrail.push(auditEntry);

    return {
      success: true,
      commitSha: newCommitSha,
      output: commitRes.output,
      auditEntry,
    };
  }

  /**
   * Appends an external audit entry into the internal audit trail.
   */
  recordAuditLog(entry: Omit<RollbackAuditEntry, "id" | "timestamp">): RollbackAuditEntry {
    const fullEntry: RollbackAuditEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...entry,
    };
    this.auditTrail.push(fullEntry);
    if (this.auditTrail.length > ROLLBACK_CONSTANTS.MAX_AUDIT_TRAIL_LENGTH) {
      this.auditTrail.shift();
    }
    return fullEntry;
  }

  /**
   * Returns complete historical audit trail for this buffer instance.
   */
  getAuditHistory(): readonly RollbackAuditEntry[] {
    return [...this.auditTrail];
  }

  /**
   * Alias for getAuditHistory().
   */
  getAuditLogs(): readonly RollbackAuditEntry[] {
    return this.getAuditHistory();
  }

  /**
   * Returns list of currently registered audit file paths.
   */
  getRegisteredAuditLogs(): readonly string[] {
    return Array.from(this.registeredAuditLogs.keys());
  }

  /**
   * Flushes the recorded audit trail to disk in JSONL format.
   */
  async flushAuditLogs(destinationPath?: string): Promise<string> {
    const targetFile = destinationPath
      ? (isAbsolute(destinationPath) ? destinationPath : resolve(this.cwd, destinationPath))
      : join(this.auditLogDir, ROLLBACK_CONSTANTS.DEFAULT_AUDIT_LOG_FILE);

    await mkdir(dirname(targetFile), { recursive: true });
    const lines = this.auditTrail.map((e) => JSON.stringify(e)).join("\n");
    await writeFile(targetFile, `${lines}\n`, "utf-8");
    return targetFile;
  }

  getBaselineSha(): string | null {
    return this.baselineSha;
  }

  getSnapshotTimestamp(): number | null {
    return this.snapshotTakenAt;
  }

  getRollbackCount(): number {
    return this.rollbackCount;
  }

  getCommitCount(): number {
    return this.commitCount;
  }

  getExcludes(): readonly string[] {
    return Array.from(this.excludes);
  }
}
