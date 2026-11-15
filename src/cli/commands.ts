/**
 * Integration subcommands for the cascade CLI: `doctor`, `catalog`, `drift` and `review`.
 *
 * Exit codes: 0 success, 1 findings/drift/unhealthy, 2 invalid input or fail-closed errors.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CLI_COMMAND_CONSTANTS, EXIT_CODE_CONSTANTS, PRE_PR_CONSTANTS } from "../config/constants";
import { PrePrReviewLoop } from "../core/pre_pr_loop";
import { SelfImprover } from "../core/self_improver";
import { readCatalogJson } from "../integration/catalog_model";
import { TaskCatalogGenerator } from "../integration/catalog_generator";
import { CatalogDriftDetector } from "../integration/drift_detector";
import { GitHubProjectService, type ProjectOwnerType } from "../integration/github_project";
import { GreptileCliClient, GreptileError, type IGreptileClient } from "../integration/greptile/client";
import { GreptileReviewBridge } from "../integration/greptile/bridge";
import { EngineFactory } from "../pal/factory";
import { detectRuntime } from "../runtime/base_spawner";
import { getDefaultSpawner } from "../runtime/spawner";
import type { ISpawner } from "../runtime/types";
import { SDD_HOOK_CONSTANTS, serializeSddHookRules } from "../sdd/hook_rules";

export type CliSubcommand = (typeof CLI_COMMAND_CONSTANTS.SUBCOMMANDS)[number];

export interface CliOutput {
  info(message: string): void;
  error(message: string): void;
}

export interface SubcommandDependencies {
  readonly spawner?: ISpawner;
  readonly output?: CliOutput;
  readonly greptileClient?: IGreptileClient;
  readonly engineFactory?: EngineFactory;
}

type CheckStatus = typeof CLI_COMMAND_CONSTANTS.STATUS_OK | typeof CLI_COMMAND_CONSTANTS.STATUS_WARN | typeof CLI_COMMAND_CONSTANTS.STATUS_FAIL;

export interface DoctorCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

class UsageError extends Error {}

const consoleOutput: CliOutput = { info: (message) => console.log(message), error: (message) => console.error(message) };

/**
 * Returns the subcommand named by `argv[0]`, if any.
 */
export function detectSubcommand(argv: readonly string[]): CliSubcommand | undefined {
  const [first] = argv;
  const subcommands: readonly string[] = CLI_COMMAND_CONSTANTS.SUBCOMMANDS;
  return first !== undefined && subcommands.includes(first) ? (first as CliSubcommand) : undefined;
}

function parse<T extends Record<string, { type: "string" | "boolean" }>>(argv: readonly string[], options: T): ReturnType<typeof parseArgs<{ options: T; strict: true; allowPositionals: false }>>["values"] {
  try {
    return parseArgs({ args: [...argv], options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function requireString(value: string | boolean | undefined, flag: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new UsageError(`${flag} is required`);
  return value;
}

function parsePositiveInt(value: string | boolean | undefined, flag: string): number;
function parsePositiveInt(value: string | boolean | undefined, flag: string, optional: true): number | undefined;
function parsePositiveInt(value: string | boolean | undefined, flag: string, optional = false): number | undefined {
  if (value === undefined && optional) return undefined;
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`${flag} must be a positive integer`);
  return parsed;
}

function parseOwnerType(value: string | boolean | undefined): ProjectOwnerType {
  const ownerTypes: readonly string[] = CLI_COMMAND_CONSTANTS.OWNER_TYPES;
  const candidate = typeof value === "string" ? value : CLI_COMMAND_CONSTANTS.DEFAULT_OWNER_TYPE;
  if (!ownerTypes.includes(candidate)) throw new UsageError(`--owner-type must be one of ${ownerTypes.join(", ")}`);
  return candidate as ProjectOwnerType;
}

/**
 * Runs environment diagnostics for a repository.
 */
export async function runDoctor(repo: string, dependencies: SubcommandDependencies = {}): Promise<DoctorCheck[]> {
  const spawner = dependencies.spawner ?? getDefaultSpawner();
  const checks: DoctorCheck[] = [];
  const runtime = detectRuntime();
  checks.push({
    name: "runtime",
    status: CLI_COMMAND_CONSTANTS.STATUS_OK,
    detail: `${runtime} ${runtime === "bun" ? (process.versions.bun ?? "") : process.versions.node}`.trim(),
  });
  const git = await spawner.run(["git", "rev-parse", "--is-inside-work-tree"], { cwd: repo }).catch(() => undefined);
  checks.push({
    name: "git",
    status: git?.exitCode === EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS ? CLI_COMMAND_CONSTANTS.STATUS_OK : CLI_COMMAND_CONSTANTS.STATUS_FAIL,
    detail: git?.exitCode === EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS ? "inside a work tree" : "not a git repository",
  });
  const openspecDir = existsSync(join(repo, "openspec"));
  checks.push({
    name: "openspec",
    status: openspecDir ? CLI_COMMAND_CONSTANTS.STATUS_OK : CLI_COMMAND_CONSTANTS.STATUS_FAIL,
    detail: openspecDir ? "openspec/ found" : "openspec/ missing (run openspec init)",
  });
  const openspecCli = spawner.which("openspec") ?? (existsSync(join(repo, "node_modules", ".bin", "openspec")) ? "node_modules/.bin/openspec" : null);
  checks.push({
    name: "openspec-cli",
    status: openspecCli ? CLI_COMMAND_CONSTANTS.STATUS_OK : CLI_COMMAND_CONSTANTS.STATUS_WARN,
    detail: openspecCli ?? "not found (npm i -g @fission-ai/openspec)",
  });
  for (const [engine, binary] of Object.entries(CLI_COMMAND_CONSTANTS.ENGINE_BINARIES)) {
    const path = spawner.which(binary);
    checks.push({
      name: `engine:${engine}`,
      status: path ? CLI_COMMAND_CONSTANTS.STATUS_OK : CLI_COMMAND_CONSTANTS.STATUS_WARN,
      detail: path ?? `${binary} not on PATH`,
    });
  }
  const greptile = await (dependencies.greptileClient ?? new GreptileCliClient({ spawner })).checkStatus(repo).catch((error: unknown) => ({
    installed: false,
    authenticated: false,
    detail: error instanceof Error ? error.message : String(error),
  }));
  checks.push({
    name: "greptile",
    status: greptile.installed && greptile.authenticated ? CLI_COMMAND_CONSTANTS.STATUS_OK : CLI_COMMAND_CONSTANTS.STATUS_WARN,
    detail: greptile.installed ? (greptile.authenticated ? "installed and authenticated" : "installed, not authenticated") : "not installed",
  });
  const rulesPath = join(repo, SDD_HOOK_CONSTANTS.RULES_RELATIVE_PATH);
  if (existsSync(rulesPath)) {
    const inSync = readFileSync(rulesPath, "utf8") === serializeSddHookRules();
    checks.push({
      name: "plugin-hooks",
      status: inSync ? CLI_COMMAND_CONSTANTS.STATUS_OK : CLI_COMMAND_CONSTANTS.STATUS_WARN,
      detail: inSync ? "sdd_rules.json in sync" : "sdd_rules.json stale (bun run scripts/sync_plugin.ts)",
    });
  }
  const history = new SelfImprover({ rootDir: repo }).loadHistory();
  checks.push({ name: "telemetry", status: CLI_COMMAND_CONSTANTS.STATUS_OK, detail: `${history.length} record(s)` });
  return checks;
}

async function doctorCommand(argv: readonly string[], output: CliOutput, dependencies: SubcommandDependencies): Promise<number> {
  const values = parse(argv, { repo: { type: "string" } });
  const repo = resolve(typeof values.repo === "string" ? values.repo : process.cwd());
  const checks = await runDoctor(repo, dependencies);
  for (const check of checks) output.info(`${check.status.padEnd(CLI_COMMAND_CONSTANTS.STATUS_WARN.length)} ${check.name}: ${check.detail}`);
  return checks.some((check) => check.status === CLI_COMMAND_CONSTANTS.STATUS_FAIL)
    ? EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR
    : EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

function projectService(values: Record<string, string | boolean | undefined>): GitHubProjectService {
  const projectNumber = parsePositiveInt(requireString(values.project, "--project"), "--project");
  return new GitHubProjectService({
    owner: requireString(values.owner, "--owner"),
    projectNumber,
    ownerType: parseOwnerType(values["owner-type"]),
  });
}

async function catalogCommand(argv: readonly string[], output: CliOutput): Promise<number> {
  const values = parse(argv, {
    sync: { type: "boolean" },
    owner: { type: "string" },
    project: { type: "string" },
    "owner-type": { type: "string" },
    output: { type: "string" },
  });
  if (!values.sync) throw new UsageError("catalog requires --sync");
  const service = projectService(values);
  const generator = new TaskCatalogGenerator({ outputDir: typeof values.output === "string" ? resolve(values.output) : undefined });
  const result = await generator.generateFromProject(service);
  output.info(`catalog synced: ${result.totalTasks} task(s)\n  ${result.jsonPath}\n  ${result.markdownPath}`);
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

async function driftCommand(argv: readonly string[], output: CliOutput): Promise<number> {
  const values = parse(argv, {
    catalog: { type: "string" },
    "remote-json": { type: "string" },
    owner: { type: "string" },
    project: { type: "string" },
    "owner-type": { type: "string" },
  });
  const local = await readCatalogJson(resolve(requireString(values.catalog, "--catalog")));
  const remoteJson = values["remote-json"];
  const remote = typeof remoteJson === "string" ? await readCatalogJson(resolve(remoteJson)) : await projectService(values).getAllItems();
  const report = await new CatalogDriftDetector().detectDrift(local, remote);
  output.info(report.formattedSummary);
  return report.hasDrift ? EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR : EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

async function reviewCommand(argv: readonly string[], output: CliOutput, dependencies: SubcommandDependencies): Promise<number> {
  const values = parse(argv, {
    base: { type: "string" },
    repo: { type: "string" },
    rounds: { type: "string" },
    engine: { type: "string" },
  });
  const base = requireString(values.base, "--base");
  const repo = resolve(typeof values.repo === "string" ? values.repo : process.cwd());
  const rounds = parsePositiveInt(values.rounds, "--rounds", true) ?? PRE_PR_CONSTANTS.MAX_ROUNDS;
  const spawner = dependencies.spawner ?? getDefaultSpawner();
  const bridge = new GreptileReviewBridge({ client: dependencies.greptileClient ?? new GreptileCliClient({ spawner }) });
  const engine = (dependencies.engineFactory ?? new EngineFactory({ spawner })).create(
    typeof values.engine === "string" ? values.engine : CLI_COMMAND_CONSTANTS.DEFAULT_REVIEW_ENGINE,
    { cwd: repo },
  );
  const loop = new PrePrReviewLoop({
    maxRounds: rounds,
    source: { review: () => bridge.review({ repoPath: repo, baseBranch: base }) },
    fixer: async (mechanical, round) => {
      const prompt = [
        `Pre-PR review round ${round}: fix ONLY these mechanical findings, then stop. Do not commit.`,
        ...mechanical.map((finding) => `- ${finding.file}${finding.line === undefined ? "" : `:${finding.line}`} — ${finding.message}`),
      ].join("\n");
      await engine.runSession({
        prompt,
        cwd: repo,
        hooks: { onText: () => undefined, onTool: () => undefined, log: () => undefined },
      });
    },
    onRound: (record) =>
      output.info(`round ${record.round}: ${record.status} (mechanical ${record.mechanical}, risky ${record.risky}, advisory ${record.advisory})`),
  });
  const result = await loop.run();
  output.info(`pre-PR review: ${result.status} after ${result.rounds} round(s)`);
  return result.status === "clean" || result.status === "empty" ? EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS : EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
}

/**
 * Executes an integration subcommand and returns its exit code. Never throws.
 */
export async function runSubcommand(
  name: CliSubcommand,
  argv: readonly string[],
  dependencies: SubcommandDependencies = {},
): Promise<number> {
  const output = dependencies.output ?? consoleOutput;
  try {
    switch (name) {
      case "doctor":
        return await doctorCommand(argv, output, dependencies);
      case "catalog":
        return await catalogCommand(argv, output);
      case "drift":
        return await driftCommand(argv, output);
      case "review":
        return await reviewCommand(argv, output, dependencies);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      output.error(`USAGE: cascade ${name}: ${message}`);
    } else if (error instanceof GreptileError) {
      output.error(`STOPPED: ${name}: ${message}`);
    } else {
      output.error(`STOPPED: ${name} failed: ${message}`);
    }
    return EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
  }
}
