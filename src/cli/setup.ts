/**
 * `setup` subcommand: `discover` lists helpers, `add` and `remove` edit a manifest layer, `show` prints the
 * merged manifest, and `rules` prints or writes the suggested OpenSpec rules.
 *
 * Exit codes: 0 success, 1 refused write, 2 usage error or invalid manifest.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { EXIT_CODE_CONSTANTS, MANIFEST_CONSTANTS } from "../config/constants";
import { discover } from "../manifest/discover";
import { ManifestError, loadGlobalLayer, loadManifest, loadProjectLayer, resolveManifestPaths } from "../manifest/load";
import { SUGGESTED_RULES_YAML, writeRules } from "../manifest/rules";
import { ManifestEntrySchema, type ManifestLayerName } from "../manifest/types";
import { writeJsonAtomic, writeTextAtomic } from "../manifest/write";
import { getDefaultSpawner } from "../runtime/spawner";
import { CliUsageError, consoleOutput, type CliOutput } from "./change_args";

/**
 * Output sink of the subcommand.
 */
export type SetupOutput = CliOutput;

/**
 * Environment of `setup`, injectable for tests.
 */
export interface SetupDeps {
  readonly home: string;
  readonly xdgConfigHome: string;
  which(binary: string): string | null;
  gitCommonDir(repo: string): string | undefined;
}

const ACTION_DISCOVER = "discover";
const ACTION_SHOW = "show";
const ACTION_RULES = "rules";
const ACTION_ADD = "add";
const ACTION_REMOVE = "remove";
const ACTIONS = [ACTION_DISCOVER, ACTION_ADD, ACTION_REMOVE, ACTION_SHOW, ACTION_RULES] as const;
const PROJECT_FILE = ".openspec-cascade.json";
const OPENSPEC_CONFIG_RELATIVE = join("openspec", "config.yaml");
const SCOPES = ["project", "global"] as const;
const GIT_COMMON_DIR_ARGV = ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"] as const;

const OPTIONS = {
  repo: { type: "string" },
  json: { type: "boolean" },
  scope: { type: "string" },
  name: { type: "string" },
  type: { type: "string" },
  when: { type: "string" },
  required: { type: "boolean" },
  check: { type: "string" },
  profile: { type: "string" },
  host: { type: "string", multiple: true },
  write: { type: "boolean" },
} as const;

interface SetupOptions {
  readonly repo?: string;
  readonly json?: boolean;
  readonly scope?: string;
  readonly name?: string;
  readonly type?: string;
  readonly when?: string;
  readonly required?: boolean;
  readonly check?: string;
  readonly profile?: string;
  readonly host?: string[];
  readonly write?: boolean;
}

type RawEntry = Record<string, unknown>;

function parseOptions(argv: readonly string[]): SetupOptions {
  try {
    const { values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false });
    return values as SetupOptions;
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Builds the real environment: the user's home, the resolved config home, `which` and `git rev-parse`.
 */
export function realSetupDeps(): SetupDeps {
  const home = homedir();
  const spawner = getDefaultSpawner();
  return {
    home,
    xdgConfigHome: resolveManifestPaths(process.env, home).xdgConfigHome,
    which: (binary) => spawner.which(binary),
    gitCommonDir: (repo) => {
      const result = spawner.spawnSync(GIT_COMMON_DIR_ARGV, { cwd: repo });
      const text = result.stdout.trim();
      return result.exitCode === EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS && text !== "" ? text : undefined;
    },
  };
}

function printJson(output: SetupOutput, value: unknown): void {
  output.info(JSON.stringify(value, null, MANIFEST_CONSTANTS.JSON_INDENT));
}

function runDiscover(options: SetupOptions, output: SetupOutput, deps: SetupDeps): number {
  const repo = resolve(options.repo ?? process.cwd());
  const result = discover({ home: deps.home, xdgConfigHome: deps.xdgConfigHome, repo }, deps);
  if (options.json === true) {
    printJson(output, result);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
  }
  for (const item of result.candidates) {
    const where = item.inManifest === null ? "not in manifest" : `in ${item.inManifest} layer`;
    output.info(`${item.type} ${item.name} [${item.hosts.join(",")}] (${where}) from ${item.sources.join(", ")}`);
  }
  for (const item of result.skipped) output.info(`skipped ${item.source}: ${item.reason}`);
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

function runShow(options: SetupOptions, output: SetupOutput, deps: SetupDeps): number {
  const repo = resolve(options.repo ?? process.cwd());
  const entries = loadManifest({ home: deps.home, xdgConfigHome: deps.xdgConfigHome }, repo);
  if (options.json === true) {
    printJson(output, { entries });
    return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
  }
  for (const entry of entries) output.info(`${entry.layer} ${entry.type} ${entry.name}: ${entry.whenToUse}`);
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

function requireOption(value: string | undefined, flag: string): string {
  if (value === undefined) throw new CliUsageError(`--${flag} is required`);
  return value;
}

function requireScope(options: SetupOptions): ManifestLayerName {
  const scope = requireOption(options.scope, "scope");
  if (!(SCOPES as readonly string[]).includes(scope)) throw new CliUsageError(`--scope must be ${SCOPES.join(" or ")}`);
  return scope as ManifestLayerName;
}

function readRawJson(path: string, layer: ManifestLayerName): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ManifestError(layer, "invalid JSON");
  }
}

interface LayerStore {
  readonly entries: RawEntry[];
  save(entries: RawEntry[]): void;
}

function openGlobalStore(deps: SetupDeps): LayerStore {
  const folder = join(deps.xdgConfigHome, MANIFEST_CONSTANTS.GLOBAL_DIR);
  const file = join(folder, MANIFEST_CONSTANTS.GLOBAL_FILE);
  loadGlobalLayer({ home: deps.home, xdgConfigHome: deps.xdgConfigHome });
  const entries = existsSync(file) ? ((readRawJson(file, "global") as { entries: RawEntry[] }).entries) : [];
  return {
    entries,
    save: (next) => {
      mkdirSync(folder, { recursive: true });
      writeJsonAtomic(file, { entries: next });
    },
  };
}

function openProjectStore(repo: string): LayerStore {
  const file = join(repo, PROJECT_FILE);
  loadProjectLayer(repo);
  const root: Record<string, unknown> = existsSync(file) ? (readRawJson(file, "project") as Record<string, unknown>) : {};
  const manifest = root[MANIFEST_CONSTANTS.PROJECT_KEY] as { entries: RawEntry[] } | undefined;
  return {
    entries: manifest?.entries ?? [],
    save: (next) => writeJsonAtomic(file, { ...root, [MANIFEST_CONSTANTS.PROJECT_KEY]: { entries: next } }),
  };
}

function openStore(scope: ManifestLayerName, options: SetupOptions, deps: SetupDeps): LayerStore {
  return scope === "global" ? openGlobalStore(deps) : openProjectStore(resolve(options.repo ?? process.cwd()));
}

function buildEntry(options: SetupOptions): RawEntry {
  const candidate: RawEntry = {
    name: requireOption(options.name, "name"),
    type: requireOption(options.type, "type"),
    whenToUse: requireOption(options.when, "when"),
  };
  if (options.required === true) candidate.required = true;
  if (options.check !== undefined) candidate.check = options.check;
  if (options.profile !== undefined) candidate.profile = options.profile;
  if (options.host !== undefined) candidate.hosts = options.host;
  const parsed = ManifestEntrySchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CliUsageError(`invalid entry: ${issue?.path.join(".") ?? "entry"}: ${issue?.message ?? "invalid"}`);
  }
  return candidate;
}

function sameKey(entry: RawEntry, name: string, type: string): boolean {
  return entry.name === name && entry.type === type;
}

function runAdd(options: SetupOptions, output: SetupOutput, deps: SetupDeps): number {
  const scope = requireScope(options);
  const entry = buildEntry(options);
  const store = openStore(scope, options, deps);
  const index = store.entries.findIndex((existing) => sameKey(existing, String(entry.name), String(entry.type)));
  const next = [...store.entries];
  if (index >= 0) next[index] = entry;
  else next.push(entry);
  store.save(next);
  const verb = index >= 0 ? `updated ${entry.name} (${entry.type}) in` : `added ${entry.name} (${entry.type}) to`;
  output.info(`${verb} the ${scope} layer`);
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

function runRemove(options: SetupOptions, output: SetupOutput, deps: SetupDeps): number {
  const scope = requireScope(options);
  const name = requireOption(options.name, "name");
  const type = requireOption(options.type, "type");
  const store = openStore(scope, options, deps);
  const next = store.entries.filter((existing) => !sameKey(existing, name, type));
  if (next.length === store.entries.length) throw new Error(`${name} (${type}) not found in the ${scope} layer`);
  store.save(next);
  output.info(`removed ${name} (${type}) from the ${scope} layer`);
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

function runRules(options: SetupOptions, output: SetupOutput): number {
  if (options.write !== true) {
    output.info(SUGGESTED_RULES_YAML.trimEnd());
    return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
  }
  const file = join(resolve(options.repo ?? process.cwd()), OPENSPEC_CONFIG_RELATIVE);
  if (!existsSync(file)) throw new Error("openspec/config.yaml not found; run openspec init first");
  const result = writeRules(readFileSync(file, "utf8"));
  if ("refused" in result) {
    output.error(`REFUSED: ${result.refused}`);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
  }
  writeTextAtomic(file, result.text);
  output.info("wrote rules to openspec/config.yaml");
  return EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
}

function dispatch(argv: readonly string[], output: SetupOutput, deps: SetupDeps): number {
  const [action, ...rest] = argv;
  if (!(ACTIONS as readonly (string | undefined)[]).includes(action)) {
    throw new CliUsageError(`first argument must be ${ACTIONS.join(", ")}`);
  }
  const options = parseOptions(rest);
  if (action === ACTION_DISCOVER) return runDiscover(options, output, deps);
  if (action === ACTION_SHOW) return runShow(options, output, deps);
  if (action === ACTION_ADD) return runAdd(options, output, deps);
  if (action === ACTION_REMOVE) return runRemove(options, output, deps);
  return runRules(options, output);
}

/**
 * Runs `setup <action>`. Returns the exit code; never throws.
 */
export function runSetup(argv: readonly string[], output: SetupOutput = consoleOutput, deps: SetupDeps = realSetupDeps()): number {
  try {
    return dispatch(argv, output, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(error instanceof CliUsageError ? `USAGE: cascade setup: ${message}` : `STOPPED: setup: ${message}`);
    return EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
  }
}
