/**
 * Deterministic execution-context assembly for agent sessions.
 *
 * Combines the task, harness rules, remediation directives (self-improvement), the
 * OpenSpec change artifacts, the project constitution, in-repo skills/directives,
 * Greptile review context and guardrails into ordered, token-estimated sections.
 * Identical inputs always produce byte-identical prompts.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { discoverDirectives, discoverSkills, formatDirectivesPrompt, formatSkillsPrompt } from "../../skills";
import { HARNESS_CONSTANTS, RUNTIME_CONSTANTS, SDD_CONSTANTS } from "../config/constants";
import type { Task } from "../facade/tasks";
import { estimateTokens } from "../integration/greptile/search";

export type HarnessSectionName = (typeof HARNESS_CONSTANTS.SECTION_ORDER)[number];

/**
 * A bounded, deduplicated instruction derived from recurring failures (produced by `SelfImprover`).
 */
export interface RemediationDirective {
  readonly id: string;
  readonly signature: string;
  readonly directive: string;
  readonly occurrences: number;
}

export interface HarnessGuardrails {
  readonly protectedBranches?: readonly string[];
  readonly deniedCommands?: readonly string[];
  readonly maxBudgetPerSessionUsd?: number;
}

export interface HarnessInput {
  readonly repoRoot: string;
  readonly changeId: string;
  readonly task: Task;
  readonly verifyCommands?: readonly string[];
  readonly sectionCommit?: boolean;
  readonly greptileContext?: string;
  readonly remediationDirectives?: readonly RemediationDirective[];
  readonly guardrails?: HarnessGuardrails;
  readonly retryFeedback?: string;
}

export interface HarnessSection {
  readonly name: HarnessSectionName;
  readonly content: string;
  readonly tokens: number;
}

export interface InjectedHarness {
  readonly prompt: string;
  readonly sections: readonly HarnessSection[];
  readonly totalTokens: number;
  readonly truncatedArtifacts: readonly string[];
}

function truncate(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) return { text: content, truncated: false };
  return { text: content.slice(0, maxChars) + HARNESS_CONSTANTS.TRUNCATION_MARKER, truncated: true };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function listSpecFiles(specsDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(specsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(specsDir, entry.name);
      if (entry.isDirectory()) return listSpecFiles(path);
      return entry.name === HARNESS_CONSTANTS.SPEC_FILENAME ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

function taskSection(input: HarnessInput): string {
  const lines = [
    `You are executing the OpenSpec change "${input.changeId}" in this repository, one task per session.`,
    `Implement ONLY task ${input.task.id} (section "${input.task.section}"):`,
    input.task.text,
  ];
  if (input.retryFeedback) {
    lines.push("", "Feedback from the previous attempt (fix these before anything else):", input.retryFeedback);
  }
  return lines.join("\n");
}

function rulesSection(input: HarnessInput): string {
  const verify = input.verifyCommands ?? [];
  const tasksFile = `openspec/changes/${input.changeId}/tasks.md`;
  return [
    "Rules:",
    "- Do not work on any other task, and do not change other checkboxes.",
    "- Do not commit, push, switch branches, stash or reset; the harness owns git.",
    "- Spec before code: implement exactly what the change's specs require; zero magic numbers, zero `any`, no comments inside function bodies.",
    verify.length
      ? `- The harness will verify with: ${verify.map((command) => `\`${command}\``).join(", ")}. Run them yourself and fix whatever fails before finishing.`
      : "- Run the focused checks that prove this task works before finishing.",
    `- When the task is done, change its checkbox in ${tasksFile} from "- [ ]" to "- [x]".`,
    '- ONLY if the task cannot be completed without a human decision, leave it unchecked and end with a line "BLOCKED: <reason>".',
    input.sectionCommit
      ? `- This task closes section "${input.task.section}". End your final reply with a line "COMMIT_MESSAGE: <type>(<scope>): <summary>" using Conventional Commits.`
      : `- End your final reply with a line "COMMIT_SUBJECT: <imperative summary, max ${RUNTIME_CONSTANTS.COMMIT_SUBJECT_MAX_LENGTH} chars>".`,
  ].join("\n");
}

function remediationSection(directives: readonly RemediationDirective[]): string {
  const bounded = [...directives]
    .sort((left, right) => right.occurrences - left.occurrences || left.id.localeCompare(right.id))
    .slice(0, HARNESS_CONSTANTS.MAX_REMEDIATION_DIRECTIVES);
  return [
    "Lessons from previous failures in this repository (apply them proactively):",
    ...bounded.map((directive) => `- [${directive.id}, seen ${directive.occurrences}x] ${directive.directive}`),
  ].join("\n");
}

function guardrailsSection(guardrails: HarnessGuardrails): string {
  const lines = ["Guardrails enforced by the harness:"];
  if (guardrails.protectedBranches?.length) lines.push(`- Protected branches (never touched): ${guardrails.protectedBranches.join(", ")}`);
  if (guardrails.deniedCommands?.length) lines.push(`- Denied commands: ${guardrails.deniedCommands.join(", ")}`);
  if (guardrails.maxBudgetPerSessionUsd !== undefined) lines.push(`- Session budget: $${guardrails.maxBudgetPerSessionUsd}`);
  return lines.join("\n");
}

export class HarnessInjector {
  /**
   * Builds the ordered, token-estimated execution context for one task session.
   */
  async buildExecutionContext(input: HarnessInput): Promise<InjectedHarness> {
    const changeDir = join(input.repoRoot, ...HARNESS_CONSTANTS.CHANGES_DIR, input.changeId);
    const truncatedArtifacts: string[] = [];
    const contents = new Map<HarnessSectionName, string>();

    contents.set("task", taskSection(input));
    contents.set("rules", rulesSection(input));
    if (input.remediationDirectives?.length) {
      contents.set("remediation", remediationSection(input.remediationDirectives));
    }

    const artifactPaths = [
      ...HARNESS_CONSTANTS.ARTIFACT_FILES.map((file) => join(changeDir, file)),
      ...(await listSpecFiles(join(changeDir, HARNESS_CONSTANTS.SPECS_DIR))),
    ];
    const artifactBlocks: string[] = [];
    for (const path of artifactPaths) {
      const content = await readOptional(path);
      if (content === undefined) continue;
      const label = relative(input.repoRoot, path).split("\\").join("/");
      const { text, truncated } = truncate(content.trim(), HARNESS_CONSTANTS.MAX_ARTIFACT_CHARS);
      if (truncated) truncatedArtifacts.push(label);
      artifactBlocks.push(`### ${label}\n${text}`);
    }
    if (artifactBlocks.length) {
      contents.set("artifacts", ["OpenSpec change artifacts:", ...artifactBlocks].join("\n\n"));
    }

    const constitution = await readOptional(join(input.repoRoot, SDD_CONSTANTS.SDD_CONSTITUTION_PATH));
    if (constitution !== undefined) {
      const { text, truncated } = truncate(constitution.trim(), HARNESS_CONSTANTS.MAX_CONSTITUTION_CHARS);
      if (truncated) truncatedArtifacts.push(SDD_CONSTANTS.SDD_CONSTITUTION_PATH);
      contents.set("constitution", `Project constitution (${SDD_CONSTANTS.SDD_CONSTITUTION_PATH}):\n${text}`);
    }

    const skills = [formatSkillsPrompt(discoverSkills(input.repoRoot)), formatDirectivesPrompt(discoverDirectives(input.repoRoot))]
      .filter(Boolean)
      .join("\n\n");
    if (skills) contents.set("skills", skills);
    if (input.greptileContext?.trim()) contents.set("greptile", input.greptileContext.trim());
    if (input.guardrails) contents.set("guardrails", guardrailsSection(input.guardrails));

    const sections: HarnessSection[] = HARNESS_CONSTANTS.SECTION_ORDER.flatMap((name) => {
      const content = contents.get(name);
      return content === undefined ? [] : [{ name, content, tokens: estimateTokens(content) }];
    });
    const prompt = sections.map((section) => section.content).join("\n\n");
    return { prompt, sections, totalTokens: estimateTokens(prompt), truncatedArtifacts };
  }
}
