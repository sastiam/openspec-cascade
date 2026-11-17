import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, writeTextAtomic } from "../../src/manifest/write";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "write-"));
  dirs.push(dir);
  return dir;
}

describe("writeTextAtomic", () => {
  test("writes the exact text", () => {
    const target = join(tempDir(), "a.txt");
    writeTextAtomic(target, "hello\nworld");
    expect(readFileSync(target, "utf8")).toBe("hello\nworld");
  });

  test("replaces an existing file", () => {
    const target = join(tempDir(), "a.txt");
    writeFileSync(target, "old");
    writeTextAtomic(target, "new");
    expect(readFileSync(target, "utf8")).toBe("new");
  });

  test("leaves no temporary file behind", () => {
    const dir = tempDir();
    writeTextAtomic(join(dir, "a.txt"), "x");
    expect(readdirSync(dir)).toEqual(["a.txt"]);
  });

  test("cleans up and throws when the target cannot be replaced", () => {
    const dir = tempDir();
    expect(() => writeTextAtomic(join(dir, "missing", "a.txt"), "x")).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("writeJsonAtomic", () => {
  test("writes two-space JSON ending in a line break", () => {
    const target = join(tempDir(), "a.json");
    writeJsonAtomic(target, { a: [1] });
    expect(readFileSync(target, "utf8")).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });

  test("leaves no temporary file and replaces existing content", () => {
    const dir = tempDir();
    const target = join(dir, "a.json");
    writeFileSync(target, "{}");
    writeJsonAtomic(target, { b: 2 });
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ b: 2 });
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });
});
