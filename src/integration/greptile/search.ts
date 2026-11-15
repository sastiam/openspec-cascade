/**
 * Token-budgeted semantic context formatter for prompt injection.
 */
import { GREPTILE_CONSTANTS } from "../../config/constants";
import type { GreptileFinding } from "./client";

/**
 * Conservative token estimate (`ceil(chars / CHARS_PER_TOKEN)`).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / GREPTILE_CONSTANTS.CHARS_PER_TOKEN);
}

/**
 * Orders findings by severity (critical first), then path and line.
 */
export function sortFindingsBySeverity(findings: readonly GreptileFinding[]): GreptileFinding[] {
  return [...findings].sort(
    (left, right) =>
      GREPTILE_CONSTANTS.SEVERITY_RANK[right.severity] - GREPTILE_CONSTANTS.SEVERITY_RANK[left.severity] ||
      left.file.localeCompare(right.file) ||
      (left.line ?? 0) - (right.line ?? 0),
  );
}

function formatFinding(finding: GreptileFinding): string {
  const location = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
  const security = finding.securityIssue ? " [security]" : "";
  return `- [${finding.severity}]${security} ${location} — ${finding.message.replace(/\s+/g, " ")}`;
}

/**
 * Renders findings as a Markdown block whose estimated token count never exceeds `tokenBudget`.
 * Returns an empty string when there are no findings or the budget cannot fit the header.
 */
export function formatGreptileContext(
  findings: readonly GreptileFinding[],
  tokenBudget: number = GREPTILE_CONSTANTS.DEFAULT_TOKEN_BUDGET,
): string {
  if (findings.length === 0) return "";
  const header = GREPTILE_CONSTANTS.CONTEXT_HEADER;
  if (estimateTokens(header) > tokenBudget) return "";
  const sorted = sortFindingsBySeverity(findings);
  const omissionLine = (omitted: number): string => `- … ${omitted} more finding(s) omitted (token budget ${tokenBudget})`;
  const lines: string[] = [header];
  for (const [index, finding] of sorted.entries()) {
    const remainingAfter = sorted.length - index - 1;
    const candidate = [...lines, formatFinding(finding), ...(remainingAfter > 0 ? [omissionLine(remainingAfter)] : [])];
    if (estimateTokens(candidate.join("\n")) > tokenBudget) {
      const omitted = sorted.length - index;
      if (estimateTokens([...lines, omissionLine(omitted)].join("\n")) <= tokenBudget) {
        lines.push(omissionLine(omitted));
      }
      break;
    }
    lines.push(formatFinding(finding));
  }
  return lines.join("\n");
}
