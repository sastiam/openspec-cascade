/**
 * Single source of truth for the dependency-free Claude Code plugin hook
 * (`plugins/cascade/hooks/sdd_gate.{mjs,cjs}`), generated into `sdd_rules.json`.
 */
import { EXIT_CODE_CONSTANTS, SDD_CONSTANTS } from "../config/constants";

export const SDD_HOOK_CONSTANTS = {
  RULES_RELATIVE_PATH: "plugins/cascade/hooks/sdd_rules.json",
  DISABLE_ENV: "CASCADE_SDD_GATE_DISABLED",
  DISABLE_VALUE: "1",
  SCHEMA_VERSION: 1,
  JSON_INDENT: 2,
  BLOCK_MESSAGE:
    "SDD Gate Block: Attempted modification of production source without an active OpenSpec change. " +
    "Spec before code: create or activate a validated change under openspec/changes/ with pending tasks in tasks.md before editing code. " +
    "(Tests, docs, and specifications are exempt; set CASCADE_SDD_GATE_DISABLED=1 to bypass).",
} as const;

export interface SddHookRules {
  readonly schemaVersion: number;
  readonly productionExtensions: readonly string[];
  readonly exemptPathSegments: readonly string[];
  readonly exemptNamePrefixes: readonly string[];
  readonly exemptNameSuffixes: readonly string[];
  readonly gatedTools: readonly string[];
  readonly blockExitCode: number;
  readonly disableEnv: string;
  readonly disableValue: string;
  readonly blockMessage: string;
}

/**
 * Builds the hook rule document from the centralized constants.
 */
export function buildSddHookRules(): SddHookRules {
  return {
    schemaVersion: SDD_HOOK_CONSTANTS.SCHEMA_VERSION,
    productionExtensions: SDD_CONSTANTS.SDD_PRODUCTION_EXTENSIONS,
    exemptPathSegments: SDD_CONSTANTS.SDD_EXEMPT_PATH_SEGMENTS,
    exemptNamePrefixes: SDD_CONSTANTS.SDD_EXEMPT_NAME_PREFIXES,
    exemptNameSuffixes: SDD_CONSTANTS.SDD_EXEMPT_NAME_SUFFIXES,
    gatedTools: SDD_CONSTANTS.SDD_GATED_TOOLS,
    blockExitCode: EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL,
    disableEnv: SDD_HOOK_CONSTANTS.DISABLE_ENV,
    disableValue: SDD_HOOK_CONSTANTS.DISABLE_VALUE,
    blockMessage: SDD_HOOK_CONSTANTS.BLOCK_MESSAGE,
  };
}

/**
 * Serialized rule file content (stable formatting, trailing newline).
 */
export function serializeSddHookRules(rules: SddHookRules = buildSddHookRules()): string {
  return `${JSON.stringify(rules, null, SDD_HOOK_CONSTANTS.JSON_INDENT)}\n`;
}
