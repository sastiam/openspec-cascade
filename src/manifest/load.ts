import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_CONSTANTS } from "../config/constants";
import {
  ManifestEntrySchema,
  ManifestLayerSchema,
  type ManifestEntry,
  type ManifestLayerName,
  type ManifestPaths,
  type MergedEntry,
} from "./types";

const PROJECT_FILE = ".openspec-cascade.json";
const DEFAULT_CONFIG_DIR = ".config";

export class ManifestError extends Error {
  constructor(layer: ManifestLayerName, detail: string) {
    super(`${layer} layer: ${detail}`);
    this.name = "ManifestError";
  }
}

export function resolveManifestPaths(env: Record<string, string | undefined>, home: string): ManifestPaths {
  const configured = env.XDG_CONFIG_HOME;
  const xdgConfigHome = configured !== undefined && configured !== "" ? configured : join(home, DEFAULT_CONFIG_DIR);
  return { home, xdgConfigHome };
}

function readJson(path: string, layer: ManifestLayerName): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ManifestError(layer, "unreadable file");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ManifestError(layer, "invalid JSON");
  }
}

function usableName(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const name = (raw as { name?: unknown }).name;
  return typeof name === "string" && /^[^\r\n]+$/.test(name) ? name : undefined;
}

function entryLabel(raw: unknown, index: number): string {
  const name = usableName(raw);
  if (name === undefined) return `entry #${index}`;
  const type = (raw as { type?: unknown }).type;
  const known = (MANIFEST_CONSTANTS.ENTRY_TYPES as readonly unknown[]).includes(type);
  return known ? `${name} (${String(type)})` : name;
}

function describeIssue(path: PropertyKey[], message: string): string {
  const field = path.length > 0 ? String(path[0]) : undefined;
  if (field === undefined) return "invalid entry";
  if (message.startsWith(field)) return message;
  if (field === "type") return "type is not one of mcp, skill, plugin, cli";
  if (field === "profile") return "profile has invalid characters";
  if (field === "hosts") return message.startsWith("hosts") ? message : "hosts is invalid";
  if (field === "required") return "required must be a boolean";
  return `${field} is invalid`;
}

function parseEntries(rawEntries: unknown[], layer: ManifestLayerName): ManifestEntry[] {
  const seen = new Set<string>();
  return rawEntries.map((raw, index) => {
    const label = entryLabel(raw, index);
    const parsed = ManifestEntrySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = issue === undefined ? "invalid entry" : describeIssue(issue.path, issue.message);
      throw new ManifestError(layer, `${label}: ${detail}`);
    }
    const key = `${parsed.data.type}\u0000${parsed.data.name}`;
    if (seen.has(key)) throw new ManifestError(layer, `${label}: duplicate entry`);
    seen.add(key);
    return parsed.data;
  });
}

function parseLayer(value: unknown, layer: ManifestLayerName): ManifestEntry[] {
  const parsed = ManifestLayerSchema.safeParse(value);
  if (!parsed.success) throw new ManifestError(layer, "entries must be a list");
  return parseEntries(parsed.data.entries, layer);
}

export function loadGlobalLayer(paths: ManifestPaths): ManifestEntry[] {
  const file = join(paths.xdgConfigHome, MANIFEST_CONSTANTS.GLOBAL_DIR, MANIFEST_CONSTANTS.GLOBAL_FILE);
  if (!existsSync(file)) return [];
  return parseLayer(readJson(file, "global"), "global");
}

export function loadProjectLayer(repo: string): ManifestEntry[] {
  const file = join(repo, PROJECT_FILE);
  if (!existsSync(file)) return [];
  const root = readJson(file, "project");
  if (typeof root !== "object" || root === null || Array.isArray(root)) throw new ManifestError("project", "invalid config file");
  const layer = (root as Record<string, unknown>)[MANIFEST_CONSTANTS.PROJECT_KEY];
  if (layer === undefined) return [];
  return parseLayer(layer, "project");
}

export function mergeLayers(global: ManifestEntry[], project: ManifestEntry[]): MergedEntry[] {
  const merged = new Map<string, MergedEntry>();
  const keyOf = (entry: ManifestEntry): string => `${entry.type}\u0000${entry.name}`;
  for (const entry of global) merged.set(keyOf(entry), { ...entry, layer: "global" });
  for (const entry of project) merged.set(keyOf(entry), { ...entry, layer: "project" });
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

export function loadManifest(paths: ManifestPaths, repo: string): MergedEntry[] {
  return mergeLayers(loadGlobalLayer(paths), loadProjectLayer(repo));
}
