import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { E2E_CONSTANTS } from "./constants";

export interface CliRunOptions {
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  timeoutMs?: number;
}

export interface NodeScriptOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  stdin?: string;
  timeoutMs?: number;
}

export interface OpenSpecCliOptions {
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

const INHERITED_ENV_BLOCKLIST = new Set<string>([
  "ARCHIFY_BIN",
  "CASCADE_ARCHIFY_ACTION",
  "CASCADE_ARCHIFY_BIN",
  "CASCADE_ARCHIFY_QUALITY",
  "CASCADE_ALLOW_DIRTY",
  "CASCADE_AUTO_DIAGRAMS",
  "CASCADE_CHANGES",
  "CASCADE_COMMAND_TIMEOUT_MS",
  "CASCADE_CONTINUE_ON_FAILURE",
  "CASCADE_DRY_RUN",
  "CASCADE_EFFORT",
  "CASCADE_ENGINE",
  "CASCADE_ENGINE_TIMEOUT_MS",
  "CASCADE_FULL_GATE",
  "CASCADE_GIT_ROLLBACK",
  "CASCADE_GRAPHIFY_COMMAND",
  "CASCADE_KEEP_ALIVE",
  "CASCADE_LOG_DIR",
  "CASCADE_MAX_ATTEMPTS",
  "CASCADE_MAX_BUDGET_USD",
  "CASCADE_MAX_TURNS",
  "CASCADE_MIN_PAUSE_MS",
  "CASCADE_MODEL",
  "CASCADE_RATE_LIMIT_SLEEP_MS",
  "CASCADE_REPO",
  "CASCADE_RESET_MARGIN_MS",
  "CASCADE_RESILIENT",
  "CASCADE_ROLLBACK_ON_FAILURE",
  "CASCADE_SDD_GATE_DISABLED",
  "CASCADE_TOTAL_BUDGET_USD",
  "CASCADE_UNKNOWN_RESET_SLEEP_MS",
  "CASCADE_USAGE_LIMIT_PERCENT",
]);

function buildMergedPath(overridePath?: string): string {
  if (overridePath !== undefined) {
    return overridePath;
  }

  const segments = [
    dirname(process.execPath),
    join(E2E_CONSTANTS.REPO_ROOT, "node_modules", ".bin"),
    ...(process.env.PATH ? process.env.PATH.split(delimiter) : []),
    ...E2E_CONSTANTS.DEFAULT_SYSTEM_PATH.split(delimiter),
  ].filter((segment) => segment.length > 0);

  return [...new Set(segments)].join(delimiter);
}

/**
 * Builds an isolated subprocess environment that blocks inherited CASCADE_* variables
 * and redirects HOME and XDG_CACHE_HOME to temporary directories.
 */
export function buildIsolatedEnv(
  homeDir: string,
  overrides?: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !INHERITED_ENV_BLOCKLIST.has(key)) {
      env[key] = value;
    }
  }

  env.HOME = homeDir;
  env.XDG_CACHE_HOME = join(homeDir, ".cache");
  env.PATH = buildMergedPath(overrides?.PATH);

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key === "PATH") {
        continue;
      }
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  }

  return env;
}

async function executeSubprocess(
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  stdinText?: string,
): Promise<CliRunResult> {
  const startedAt = Date.now();
  const proc = Bun.spawn(argv, {
    cwd,
    env,
    stdin: stdinText !== undefined ? new TextEncoder().encode(stdinText) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill(E2E_CONSTANTS.TIMEOUT_SIGNAL);
    } catch {
      return;
    }
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the real cascade.ts CLI entrypoint in an isolated subprocess environment.
 */
export async function runCascadeCli(options: CliRunOptions): Promise<CliRunResult> {
  const ownedHomeDir =
    options.homeDir ?? mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_HOME));
  const cwd = options.cwd ?? E2E_CONSTANTS.REPO_ROOT;
  const timeoutMs = options.timeoutMs ?? E2E_CONSTANTS.DEFAULT_SUBPROCESS_TIMEOUT_MS;
  const env = buildIsolatedEnv(ownedHomeDir, options.env);

  try {
    return await executeSubprocess(
      [process.execPath, "run", E2E_CONSTANTS.CASCADE_ENTRYPOINT, ...options.args],
      cwd,
      env,
      timeoutMs,
    );
  } finally {
    if (options.homeDir === undefined) {
      rmSync(ownedHomeDir, { recursive: true, force: true });
    }
  }
}

/**
 * Runs a real Node.js script (e.g. sdd_gate.mjs or bin/install.mjs) via node.
 */
export async function runNodeScript(
  scriptPath: string,
  args: readonly string[],
  options: NodeScriptOptions = {},
): Promise<CliRunResult> {
  const ownedHomeDir =
    options.homeDir ?? mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_HOME));
  const cwd = options.cwd ?? E2E_CONSTANTS.REPO_ROOT;
  const timeoutMs = options.timeoutMs ?? E2E_CONSTANTS.DEFAULT_SUBPROCESS_TIMEOUT_MS;
  const env = buildIsolatedEnv(ownedHomeDir, options.env);
  const nodeBin = Bun.which("node") ?? "node";

  try {
    return await executeSubprocess(
      [nodeBin, scriptPath, ...args],
      cwd,
      env,
      timeoutMs,
      options.stdin,
    );
  } finally {
    if (options.homeDir === undefined) {
      rmSync(ownedHomeDir, { recursive: true, force: true });
    }
  }
}

/**
 * Runs the real OpenSpec CLI against a target repository root.
 */
export async function runOpenSpecCli(
  repoRoot: string,
  args: readonly string[],
  options: OpenSpecCliOptions = {},
): Promise<CliRunResult> {
  const localBin = join(repoRoot, "node_modules", ".bin", "openspec");
  const openspecBin = existsSync(localBin) ? localBin : E2E_CONSTANTS.OPENSPEC_BIN;
  const ownedHomeDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_HOME));
  const timeoutMs = options.timeoutMs ?? E2E_CONSTANTS.DEFAULT_SUBPROCESS_TIMEOUT_MS;
  const env = buildIsolatedEnv(ownedHomeDir, options.env);

  try {
    return await executeSubprocess([openspecBin, ...args], repoRoot, env, timeoutMs);
  } finally {
    rmSync(ownedHomeDir, { recursive: true, force: true });
  }
}
