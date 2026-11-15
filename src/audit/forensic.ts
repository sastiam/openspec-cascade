/**
 * Deterministic AST-based forensic auditor.
 *
 * Enforces the constitution rules that ESLint does not cover precisely:
 * comments inside function bodies, stubbed/mocked E2E tests, and placeholder
 * implementations. Explicit `any` is also reported so the audit is self-contained.
 * Every rule walks the TypeScript AST, so string and template literal fixtures
 * are never reported.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

export type ForensicRule =
  | "explicit-any"
  | "inline-body-comment"
  | "e2e-stub"
  | "placeholder-implementation";

export interface ForensicViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: ForensicRule;
  readonly message: string;
}

export interface ForensicAuditOptions {
  readonly e2eTest?: boolean;
  readonly production?: boolean;
}

export interface ForensicAuditReport {
  readonly filesAudited: number;
  readonly violations: readonly ForensicViolation[];
}

export const FORENSIC_CONSTANTS = {
  JSDOC_PREFIX: "/**",
  E2E_SEGMENT: `test${sep}e2e${sep}`,
  TEST_FILE_SUFFIX: ".test.ts",
  TS_EXTENSION: ".ts",
  DECLARATION_SUFFIX: ".d.ts",
  STUB_CALLEES: ["mock", "spyOn"] as const,
  STUB_NAMESPACES: ["jest", "vi", "sinon"] as const,
  STUB_MEMBER_CALLS: ["module", "restore"] as const,
  FAKE_HARNESS_IDENTIFIER: /^reference_(?:pal|spawner|engine|facade)$/i,
  PLACEHOLDER_MESSAGE: /^\s*(?:not\s+implemented|unimplemented|todo|stub|placeholder)\b/i,
  SKIPPED_DIRECTORIES: ["node_modules", ".git", "fixtures"] as const,
} as const;

/**
 * Milestone-scoped audit surface. Legacy v2 modules predating the constitution
 * join the scope as each milestone refactors them.
 */
export const FORENSIC_AUDIT_SCOPE: readonly string[] = [
  "src/config",
  "src/audit",
  "src/runtime",
  "src/decorators",
  "src/facade",
  "src/pal/factory.ts",
  "src/pal/bridge.ts",
  "src/pal/shared.ts",
  "src/integration/greptile",
  "src/core/harness_injector.ts",
  "src/core/self_improver.ts",
  "src/core/pre_pr_loop.ts",
  "src/cli",
  "config.ts",
  "platform.ts",
  "cascade.ts",
  "engine.ts",
  "qa.ts",
  "scripts",
  "test/e2e",
];

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function isFunctionLikeWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.Block } {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.body !== undefined && ts.isBlock(node.body);
  }
  return false;
}

function collectCommentsFromTrivia(sourceFile: ts.SourceFile): ts.CommentRange[] {
  const text = sourceFile.getFullText();
  const seen = new Set<number>();
  const ranges: ts.CommentRange[] = [];
  const visit = (node: ts.Node): void => {
    const leading = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    const trailing = ts.getTrailingCommentRanges(text, node.getEnd()) ?? [];
    for (const range of [...leading, ...trailing]) {
      if (!seen.has(range.pos)) {
        seen.add(range.pos);
        ranges.push(range);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const endOfFile = sourceFile.endOfFileToken;
  for (const range of ts.getLeadingCommentRanges(text, endOfFile.getFullStart()) ?? []) {
    if (!seen.has(range.pos)) {
      seen.add(range.pos);
      ranges.push(range);
    }
  }
  return ranges;
}

function callExpressionCalleeName(expression: ts.LeftHandSideExpression): { root: string; member?: string } | null {
  if (ts.isIdentifier(expression)) {
    return { root: expression.text };
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return { root: expression.expression.text, member: expression.name.text };
  }
  return null;
}

function isStubCall(node: ts.CallExpression): boolean {
  const callee = callExpressionCalleeName(node.expression);
  if (callee === null) {
    return false;
  }
  const stubCallees: readonly string[] = FORENSIC_CONSTANTS.STUB_CALLEES;
  const stubNamespaces: readonly string[] = FORENSIC_CONSTANTS.STUB_NAMESPACES;
  const stubMembers: readonly string[] = FORENSIC_CONSTANTS.STUB_MEMBER_CALLS;
  if (callee.member === undefined) {
    return stubCallees.includes(callee.root);
  }
  if (stubNamespaces.includes(callee.root)) {
    return true;
  }
  return callee.root === "mock" && stubMembers.includes(callee.member);
}

function isPlaceholderThrow(node: ts.ThrowStatement): boolean {
  const expression = node.expression;
  if (!ts.isNewExpression(expression)) {
    return false;
  }
  const firstArgument = expression.arguments?.[0];
  if (firstArgument === undefined) {
    return false;
  }
  if (ts.isStringLiteral(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument)) {
    return FORENSIC_CONSTANTS.PLACEHOLDER_MESSAGE.test(firstArgument.text);
  }
  return false;
}

/**
 * Audits a single source text. `fileName` is used for reporting and for
 * deciding whether E2E stub rules apply when `options.e2eTest` is not given.
 */
export function auditSource(
  fileName: string,
  text: string,
  options: ForensicAuditOptions = {},
): ForensicViolation[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const normalizedName = fileName.split("/").join(sep);
  const isE2e = options.e2eTest ?? normalizedName.includes(FORENSIC_CONSTANTS.E2E_SEGMENT);
  const isProduction = options.production ?? !normalizedName.endsWith(FORENSIC_CONSTANTS.TEST_FILE_SUFFIX);
  const violations: ForensicViolation[] = [];
  const bodies: Array<{ start: number; end: number }> = [];

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      violations.push({
        file: fileName,
        line: lineOf(sourceFile, node.getStart(sourceFile)),
        rule: "explicit-any",
        message: "explicit `any` type",
      });
    }
    if (isFunctionLikeWithBody(node)) {
      bodies.push({ start: node.body.getStart(sourceFile) + 1, end: node.body.getEnd() - 1 });
    }
    if (isE2e && ts.isCallExpression(node) && isStubCall(node)) {
      violations.push({
        file: fileName,
        line: lineOf(sourceFile, node.getStart(sourceFile)),
        rule: "e2e-stub",
        message: `stub/mock call \`${node.expression.getText(sourceFile)}\` in E2E test`,
      });
    }
    if (isE2e && ts.isIdentifier(node) && FORENSIC_CONSTANTS.FAKE_HARNESS_IDENTIFIER.test(node.text)) {
      violations.push({
        file: fileName,
        line: lineOf(sourceFile, node.getStart(sourceFile)),
        rule: "e2e-stub",
        message: `fake reference harness \`${node.text}\` in E2E test`,
      });
    }
    if (isProduction && ts.isThrowStatement(node) && isPlaceholderThrow(node)) {
      violations.push({
        file: fileName,
        line: lineOf(sourceFile, node.getStart(sourceFile)),
        rule: "placeholder-implementation",
        message: "placeholder `throw` left in production code",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const comment of collectCommentsFromTrivia(sourceFile)) {
    const commentText = text.slice(comment.pos, comment.end);
    if (commentText.startsWith(FORENSIC_CONSTANTS.JSDOC_PREFIX)) {
      continue;
    }
    const insideBody = bodies.some((body) => comment.pos >= body.start && comment.end <= body.end);
    if (insideBody) {
      violations.push({
        file: fileName,
        line: lineOf(sourceFile, comment.pos),
        rule: "inline-body-comment",
        message: "comment inside function body",
      });
    }
  }

  return violations.sort((left, right) => left.line - right.line);
}

function expandPath(rootDir: string, entry: string): string[] {
  const absolute = join(rootDir, entry);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return [];
  }
  if (stats.isFile()) {
    return absolute.endsWith(FORENSIC_CONSTANTS.TS_EXTENSION) && !absolute.endsWith(FORENSIC_CONSTANTS.DECLARATION_SUFFIX)
      ? [absolute]
      : [];
  }
  const skipped: readonly string[] = FORENSIC_CONSTANTS.SKIPPED_DIRECTORIES;
  return readdirSync(absolute, { withFileTypes: true })
    .filter((dirent) => !skipped.includes(dirent.name))
    .flatMap((dirent) => expandPath(absolute, dirent.name))
    .sort();
}

/**
 * Expands scope entries (files or directories, relative to `rootDir`) and audits every `.ts` file.
 */
export function auditFiles(rootDir: string, scope: readonly string[] = FORENSIC_AUDIT_SCOPE): ForensicAuditReport {
  const files = [...new Set(scope.flatMap((entry) => expandPath(rootDir, entry)))];
  const violations = files.flatMap((absolutePath) => {
    const relativePath = relative(rootDir, absolutePath);
    return auditSource(relativePath, readFileSync(absolutePath, "utf8"));
  });
  return { filesAudited: files.length, violations };
}

/**
 * Formats a report as `path:line [rule] message` lines followed by a summary line.
 */
export function formatForensicReport(report: ForensicAuditReport): string {
  const lines = report.violations.map((violation) => `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`);
  const verdict = report.violations.length === 0 ? "PASS" : "FAIL";
  lines.push(`forensic-audit ${verdict}: ${report.filesAudited} files audited, ${report.violations.length} violations`);
  return lines.join("\n");
}
