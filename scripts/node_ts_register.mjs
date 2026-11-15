/**
 * Node.js 24 LTS loader hook for running openspec-cascade TypeScript sources natively.
 *
 * Node strips erasable TypeScript syntax on its own but does not resolve the
 * extensionless relative specifiers used throughout the codebase. This hook
 * retries a failed relative resolution with `.ts` and `/index.ts`.
 *
 * Usage: node --import ./scripts/node_ts_register.mjs cascade.ts --help
 */
import { registerHooks } from "node:module";

const TS_CANDIDATE_SUFFIXES = [".ts", "/index.ts"];
const MODULE_NOT_FOUND_CODES = new Set(["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"]);

function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (!isRelativeSpecifier(specifier) || !MODULE_NOT_FOUND_CODES.has(code)) {
        throw error;
      }
      for (const suffix of TS_CANDIDATE_SUFFIXES) {
        try {
          return nextResolve(`${specifier}${suffix}`, context);
        } catch {
          continue;
        }
      }
      throw error;
    }
  },
});
