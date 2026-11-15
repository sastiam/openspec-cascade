import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dir, "..", "..");
const ALLOWED = new Set(["src/runtime/bun_spawner.ts", "src/runtime/base_spawner.ts"]);
const FORBIDDEN_MEMBERS = new Set(["spawn", "spawnSync", "sleep", "sleepSync", "which", "$"]);

function productionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return productionFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

function bunApiCalls(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Bun" &&
      FORBIDDEN_MEMBERS.has(node.name.text)
    ) {
      hits.push(`${relative(ROOT, path)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} Bun.${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("isomorphic runtime boundary", () => {
  test("no production module calls the Bun process API outside src/runtime/bun_spawner.ts", () => {
    const rootFiles = readdirSync(ROOT)
      .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
      .map((entry) => join(ROOT, entry));
    const files = [...rootFiles, ...productionFiles(join(ROOT, "src"))].filter(
      (path) => !ALLOWED.has(relative(ROOT, path)),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap(bunApiCalls)).toEqual([]);
  });
});
