import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const COMMAND_PATH = join(import.meta.dir, "..", "..", "plugins", "cascade", "commands", "setup.md");
const FRONTMATTER_DELIMITER = "---";
const REQUIRED_SNIPPETS = [
  "setup discover --json",
  "setup add",
  "setup rules",
  "--write",
  "whenToUse",
  "profile",
  "claude.ai",
  "read-only",
];

function lines(): string[] {
  return readFileSync(COMMAND_PATH, "utf8").split("\n");
}

describe("setup plugin command", () => {
  test("file exists", () => {
    expect(existsSync(COMMAND_PATH)).toBe(true);
  });

  test("frontmatter starts with name: setup", () => {
    const all = lines();
    expect(all[0]).toBe(FRONTMATTER_DELIMITER);
    expect(all[1]).toBe("name: setup");
  });

  test("frontmatter has a description and closes", () => {
    const all = lines();
    const close = all.indexOf(FRONTMATTER_DELIMITER, 1);
    expect(close).toBeGreaterThan(1);
    const frontmatter = all.slice(1, close);
    expect(frontmatter.some((line) => /^description:\s*\S/.test(line))).toBe(true);
  });

  test.each(REQUIRED_SNIPPETS)("body contains %s", (snippet) => {
    expect(readFileSync(COMMAND_PATH, "utf8")).toContain(snippet);
  });
});
