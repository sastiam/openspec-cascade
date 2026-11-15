/**
 * Regenerates `plugins/cascade/hooks/sdd_rules.json` from TypeScript constants.
 * `--check` exits non-zero (without writing) when the committed file is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_CODE_CONSTANTS, RUNTIME_CONSTANTS } from "../src/config/constants";
import { SDD_HOOK_CONSTANTS, serializeSddHookRules } from "../src/sdd/hook_rules";

const target = join(process.cwd(), SDD_HOOK_CONSTANTS.RULES_RELATIVE_PATH);
const expected = serializeSddHookRules();
const checkOnly = process.argv.slice(RUNTIME_CONSTANTS.ARGV_START_INDEX).includes("--check");
let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  current = "";
}
if (current === expected) {
  console.log(`plugin hook rules up to date: ${SDD_HOOK_CONSTANTS.RULES_RELATIVE_PATH}`);
  process.exitCode = EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
} else if (checkOnly) {
  console.error(`plugin hook rules are stale: run "bun run scripts/sync_plugin.ts"`);
  process.exitCode = EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
} else {
  writeFileSync(target, expected);
  console.log(`wrote ${SDD_HOOK_CONSTANTS.RULES_RELATIVE_PATH}`);
}
