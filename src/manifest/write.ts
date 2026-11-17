import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { MANIFEST_CONSTANTS } from "../config/constants";

export function writeTextAtomic(path: string, text: string): void {
  const temporary = join(dirname(path), `${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeTextAtomic(path, `${JSON.stringify(value, null, MANIFEST_CONSTANTS.JSON_INDENT)}\n`);
}
