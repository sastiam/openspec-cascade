import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dir, "..", "..");

/**
 * Type-only edges from a gate contract module to the implementation class it names in an options interface.
 * They are erased at runtime; turning them into ports would break public accessors such as `getAssertionInjector()`.
 */
const ALLOWED_TYPE_ONLY_EDGES = new Set([
  "src/gates/gate2_types.ts -> src/gates/gate2_injector.ts",
  "src/gates/gate3_types.ts -> src/gates/gate3_scanner.ts",
]);

interface Edge {
  readonly to: string;
  readonly typeOnly: boolean;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

function resolveSpecifier(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalize(join(dirname(from), specifier));
  return [base, `${base}.ts`, join(base, "index.ts")].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function isTypeOnlyImport(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
  const clause = statement.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name !== undefined) return false;
  const bindings = clause.namedBindings;
  return bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function buildGraph(files: readonly string[]): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>();
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const edges: Edge[] = [];
    for (const statement of source.statements) {
      if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveSpecifier(file, statement.moduleSpecifier.text);
        if (target !== undefined) edges.push({ to: target, typeOnly: isTypeOnlyImport(statement) });
      }
    }
    graph.set(file, edges);
  }
  return graph;
}

function stronglyConnectedComponents(graph: Map<string, Edge[]>, includeEdge: (from: string, edge: Edge) => boolean): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (node: string): void => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);
    for (const edge of graph.get(node) ?? []) {
      if (!includeEdge(node, edge) || !graph.has(edge.to)) continue;
      if (!indices.has(edge.to)) {
        visit(edge.to);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(edge.to) ?? 0));
      } else if (onStack.has(edge.to)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indices.get(edge.to) ?? 0));
      }
    }
    if (lowLinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      for (;;) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(relative(ROOT, member));
        if (member === node) break;
      }
      if (component.length > 1) components.push(component.sort());
    }
  };
  for (const node of graph.keys()) if (!indices.has(node)) visit(node);
  return components;
}

describe("module graph", () => {
  const rootFiles = readdirSync(ROOT)
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => join(ROOT, entry));
  const graph = buildGraph([...rootFiles, ...sourceFiles(join(ROOT, "src"))]);

  test("has no runtime (value) import cycles", () => {
    expect(stronglyConnectedComponents(graph, (_from, edge) => !edge.typeOnly)).toEqual([]);
  });

  test("has no type-level import cycles beyond the documented allowlist", () => {
    const allowed = (from: string, edge: Edge): boolean =>
      !(edge.typeOnly && ALLOWED_TYPE_ONLY_EDGES.has(`${relative(ROOT, from)} -> ${relative(ROOT, edge.to)}`));
    expect(stronglyConnectedComponents(graph, allowed)).toEqual([]);
  });

  test("the allowlist only contains type-only edges that still exist", () => {
    for (const entry of ALLOWED_TYPE_ONLY_EDGES) {
      const [from, to] = entry.split(" -> ") as [string, string];
      const edges = graph.get(join(ROOT, from)) ?? [];
      expect(edges.some((edge) => relative(ROOT, edge.to) === to && edge.typeOnly)).toBe(true);
    }
  });
});
