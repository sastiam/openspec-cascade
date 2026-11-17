import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { MANIFEST_CONSTANTS } from "../config/constants";
import { stripJsonc } from "./jsonc";
import { loadManifest } from "./load";
import type { ManifestLayerName } from "./types";

export type DiscoveryType = (typeof MANIFEST_CONSTANTS.ENTRY_TYPES)[number];
export type DiscoveryHost = (typeof MANIFEST_CONSTANTS.HOSTS)[number];

export interface DiscoveryPaths {
  home: string;
  xdgConfigHome: string;
  repo: string;
}

export interface DiscoveryDeps {
  which(binary: string): string | null;
  gitCommonDir(repo: string): string | undefined;
}

export interface DiscoveryCandidate {
  name: string;
  type: DiscoveryType;
  sources: string[];
  hosts: DiscoveryHost[];
  inManifest: ManifestLayerName | null;
}

export interface SkippedSource {
  source: string;
  reason: string;
}

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  skipped: SkippedSource[];
}

interface RawCandidate {
  name: string;
  type: DiscoveryType;
  source: string;
  host: DiscoveryHost | null;
}

interface SourceResult {
  candidates: RawCandidate[];
  skipped: SkippedSource[];
}

type JsonObject = Record<string, unknown>;

type ReadOutcome = { kind: "missing" } | { kind: "skipped"; reason: string } | { kind: "ok"; value: JsonObject };

const CLAUDE = "claude-code";
const OPENCODE = "opencode";
const SKILL_FILE = "SKILL.md";
const CLI_SOURCE = "PATH";
const REASON_UNREADABLE = "unreadable";
const REASON_JSON = "invalid JSON";
const REASON_JSONC = "invalid JSONC";
const REASON_SHAPE = "unexpected shape";
const HOME_PREFIX = "~";
const REPO_PREFIX = "<repo>";

function emptyResult(): SourceResult {
  return { candidates: [], skipped: [] };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObject(file: string, jsonc: boolean): ReadOutcome {
  if (!existsSync(file)) return { kind: "missing" };
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { kind: "skipped", reason: REASON_UNREADABLE };
  }
  let value: unknown;
  try {
    value = JSON.parse(jsonc ? stripJsonc(text) : text);
  } catch {
    return { kind: "skipped", reason: jsonc ? REASON_JSONC : REASON_JSON };
  }
  return isObject(value) ? { kind: "ok", value } : { kind: "skipped", reason: REASON_SHAPE };
}

function keysOf(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  return isObject(value) ? Object.keys(value) : undefined;
}

function fromKeys(names: string[], type: DiscoveryType, source: string, host: DiscoveryHost | null): SourceResult {
  return { candidates: names.map((name) => ({ name, type, source, host })), skipped: [] };
}

function mcpFromObject(file: string, label: string, jsonc: boolean, host: DiscoveryHost, pick: (root: JsonObject) => unknown): SourceResult {
  const outcome = readObject(file, jsonc);
  if (outcome.kind === "missing") return emptyResult();
  if (outcome.kind === "skipped") return { candidates: [], skipped: [{ source: label, reason: outcome.reason }] };
  const names = keysOf(pick(outcome.value));
  if (names === undefined) return { candidates: [], skipped: [{ source: label, reason: REASON_SHAPE }] };
  return fromKeys(names, "mcp", label, host);
}

function realPathOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function matchingRoots(repo: string, deps: DiscoveryDeps): Set<string> {
  const roots = new Set<string>();
  const repoReal = realPathOrUndefined(repo);
  if (repoReal !== undefined) roots.add(repoReal);
  const common = deps.gitCommonDir(repo);
  const mainReal = common === undefined ? undefined : realPathOrUndefined(dirname(common));
  if (mainReal !== undefined) roots.add(mainReal);
  return roots;
}

export function claudeMcpSource(paths: DiscoveryPaths, deps: DiscoveryDeps): SourceResult {
  const label = `${HOME_PREFIX}/.claude.json`;
  const outcome = readObject(join(paths.home, ".claude.json"), false);
  if (outcome.kind === "missing") return emptyResult();
  if (outcome.kind === "skipped") return { candidates: [], skipped: [{ source: label, reason: outcome.reason }] };
  const root = outcome.value;
  const top = keysOf(root.mcpServers);
  const projects = root.projects === undefined ? {} : root.projects;
  if (top === undefined || !isObject(projects)) return { candidates: [], skipped: [{ source: label, reason: REASON_SHAPE }] };
  const result = fromKeys(top, "mcp", label, CLAUDE);
  const roots = matchingRoots(paths.repo, deps);
  for (const [key, project] of Object.entries(projects)) {
    const real = realPathOrUndefined(key);
    if (real === undefined || !roots.has(real) || !isObject(project)) continue;
    const names = keysOf(project.mcpServers);
    if (names === undefined) {
      result.skipped.push({ source: label, reason: REASON_SHAPE });
      continue;
    }
    result.candidates.push(...fromKeys(names, "mcp", label, CLAUDE).candidates);
  }
  return result;
}

export function claudeProjectMcpSource(paths: DiscoveryPaths): SourceResult {
  return mcpFromObject(join(paths.repo, ".mcp.json"), `${REPO_PREFIX}/.mcp.json`, false, CLAUDE, (root) => root.mcpServers);
}

function skillFolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((item) => (item.isDirectory() || item.isSymbolicLink()) && existsSync(join(dir, item.name, SKILL_FILE)))
      .map((item) => item.name);
  } catch {
    return [];
  }
}

function skillsFrom(dir: string, label: string, host: DiscoveryHost): SourceResult {
  return fromKeys(skillFolders(dir), "skill", label, host);
}

export function claudeSkillsSource(paths: DiscoveryPaths): SourceResult {
  const global = skillsFrom(join(paths.home, ".claude", "skills"), `${HOME_PREFIX}/.claude/skills`, CLAUDE);
  const project = skillsFrom(join(paths.repo, ".claude", "skills"), `${REPO_PREFIX}/.claude/skills`, CLAUDE);
  return { candidates: [...global.candidates, ...project.candidates], skipped: [] };
}

export function claudePluginsSource(paths: DiscoveryPaths): SourceResult {
  const files = [
    { file: join(paths.home, ".claude", "settings.json"), label: `${HOME_PREFIX}/.claude/settings.json` },
    { file: join(paths.repo, ".claude", "settings.json"), label: `${REPO_PREFIX}/.claude/settings.json` },
    { file: join(paths.repo, ".claude", "settings.local.json"), label: `${REPO_PREFIX}/.claude/settings.local.json` },
  ];
  const finalState = new Map<string, { enabled: boolean; source: string }>();
  const skipped: SkippedSource[] = [];
  for (const { file, label } of files) {
    const outcome = readObject(file, false);
    if (outcome.kind === "missing") continue;
    if (outcome.kind === "skipped") {
      skipped.push({ source: label, reason: outcome.reason });
      continue;
    }
    const enabled = outcome.value.enabledPlugins;
    if (enabled === undefined) continue;
    if (!isObject(enabled)) {
      skipped.push({ source: label, reason: REASON_SHAPE });
      continue;
    }
    for (const [key, value] of Object.entries(enabled)) finalState.set(key, { enabled: value === true, source: label });
  }
  const candidates: RawCandidate[] = [];
  for (const [key, state] of finalState) {
    if (!state.enabled) continue;
    const name = key.split("@")[0] ?? key;
    if (name !== "") candidates.push({ name, type: "plugin", source: state.source, host: CLAUDE });
  }
  return { candidates, skipped };
}

function opencodeMcpIn(dir: string, label: string): SourceResult {
  const jsonFile = join(dir, "opencode.json");
  const useJson = existsSync(jsonFile);
  const file = useJson ? jsonFile : join(dir, "opencode.jsonc");
  const name = useJson ? "opencode.json" : "opencode.jsonc";
  return mcpFromObject(file, `${label}/${name}`, !useJson, OPENCODE, (root) => root.mcp);
}

export function opencodeMcpSource(paths: DiscoveryPaths): SourceResult {
  const global = opencodeMcpIn(join(paths.xdgConfigHome, "opencode"), `${HOME_PREFIX}/.config/opencode`);
  const project = opencodeMcpIn(paths.repo, REPO_PREFIX);
  return { candidates: [...global.candidates, ...project.candidates], skipped: [...global.skipped, ...project.skipped] };
}

export function opencodeSkillsSource(paths: DiscoveryPaths): SourceResult {
  const places = [
    { dir: join(paths.xdgConfigHome, "opencode"), label: `${HOME_PREFIX}/.config/opencode` },
    { dir: join(paths.repo, ".opencode"), label: `${REPO_PREFIX}/.opencode` },
  ];
  const candidates: RawCandidate[] = [];
  for (const { dir, label } of places) {
    for (const folder of ["skill", "skills"]) candidates.push(...skillsFrom(join(dir, folder), `${label}/${folder}`, OPENCODE).candidates);
  }
  return { candidates, skipped: [] };
}

export function cliToolsSource(deps: DiscoveryDeps): SourceResult {
  const found = MANIFEST_CONSTANTS.KNOWN_CLI_TOOLS.filter((tool) => deps.which(tool) !== null);
  return fromKeys([...found], "cli", CLI_SOURCE, null);
}

function sortedUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function mergeCandidates(raw: RawCandidate[], layers: Map<string, ManifestLayerName>): DiscoveryCandidate[] {
  const grouped = new Map<string, RawCandidate[]>();
  for (const item of raw) {
    const key = `${item.type}\u0000${item.name}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const merged = [...grouped.entries()].map(([key, items]): DiscoveryCandidate => {
    const first = items[0] as RawCandidate;
    return {
      name: first.name,
      type: first.type,
      sources: sortedUnique(items.map((item) => item.source)),
      hosts: sortedUnique(items.flatMap((item) => (item.host === null ? [] : [item.host]))),
      inManifest: layers.get(key) ?? null,
    };
  });
  return merged.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

export function discover(paths: DiscoveryPaths, deps: DiscoveryDeps): DiscoveryResult {
  const layers = new Map<string, ManifestLayerName>();
  for (const entry of loadManifest({ home: paths.home, xdgConfigHome: paths.xdgConfigHome }, paths.repo)) {
    layers.set(`${entry.type}\u0000${entry.name}`, entry.layer);
  }
  const results = [
    claudeMcpSource(paths, deps),
    claudeProjectMcpSource(paths),
    claudeSkillsSource(paths),
    claudePluginsSource(paths),
    opencodeMcpSource(paths),
    opencodeSkillsSource(paths),
    cliToolsSource(deps),
  ];
  return {
    candidates: mergeCandidates(
      results.flatMap((result) => result.candidates),
      layers,
    ),
    skipped: results.flatMap((result) => result.skipped),
  };
}
