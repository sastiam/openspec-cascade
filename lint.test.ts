import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

describe("Linter Rules Configuration", () => {
  const eslint = new ESLint();

  test("prohibits magic numbers in TypeScript source code", async () => {
    const invalidSnippet = `
export function computeTotal(): number {
  return 42;
}
`;
    const [result] = await eslint.lintText(invalidSnippet, { filePath: "sample.ts" });
    expect(result).toBeDefined();
    if (!result) return;
    const magicNumErrors = result.messages.filter(
      (m) => m.ruleId === "@typescript-eslint/no-magic-numbers",
    );
    expect(magicNumErrors.length).toBeGreaterThan(0);
    expect(magicNumErrors[0]?.message).toContain("No magic number: 42");
  });

  test("permits constant declarations and allowed integers (0, 1, -1)", async () => {
    const validSnippet = `
const MAX_LIMIT: number = 42;

export function getLimit(): number {
  return MAX_LIMIT;
}

export function getZero(): number {
  return 0;
}
`;
    const [result] = await eslint.lintText(validSnippet, { filePath: "sample.ts" });
    expect(result).toBeDefined();
    if (!result) return;
    const magicNumErrors = result.messages.filter(
      (m) => m.ruleId === "@typescript-eslint/no-magic-numbers",
    );
    expect(magicNumErrors.length).toBe(0);
  });

  test("prohibits untyped exports (missing return type)", async () => {
    const invalidSnippet = `
export function add(a: number, b: number) {
  return a + b;
}
`;
    const [result] = await eslint.lintText(invalidSnippet, { filePath: "sample.ts" });
    expect(result).toBeDefined();
    if (!result) return;
    const exportErrors = result.messages.filter(
      (m) => m.ruleId === "@typescript-eslint/explicit-module-boundary-types",
    );
    expect(exportErrors.length).toBeGreaterThan(0);
    expect(exportErrors[0]?.message).toContain("Missing return type on function");
  });

  test("prohibits untyped exports (missing parameter types)", async () => {
    const invalidSnippet = `
export function greet(name): string {
  return \`Hello, \${name}\`;
}
`;
    const [result] = await eslint.lintText(invalidSnippet, { filePath: "sample.ts" });
    expect(result).toBeDefined();
    if (!result) return;
    const exportErrors = result.messages.filter(
      (m) => m.ruleId === "@typescript-eslint/explicit-module-boundary-types",
    );
    expect(exportErrors.length).toBeGreaterThan(0);
    expect(exportErrors[0]?.message).toContain("Argument 'name' should be typed");
  });

  test("allows magic numbers in test files (*.test.ts)", async () => {
    const testSnippet = `
export function testHelper(): number {
  return 999;
}
`;
    const [result] = await eslint.lintText(testSnippet, { filePath: "sample.test.ts" });
    expect(result).toBeDefined();
    if (!result) return;
    const magicNumErrors = result.messages.filter(
      (m) => m.ruleId === "@typescript-eslint/no-magic-numbers",
    );
    expect(magicNumErrors.length).toBe(0);
  });

  test("project files pass linting cleanly", async () => {
    const results = await eslint.lintFiles(["*.ts"]);
    const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);
    const totalWarnings = results.reduce((sum, r) => sum + r.warningCount, 0);

    expect(totalErrors).toBe(0);
    expect(totalWarnings).toBe(0);
  });
});
