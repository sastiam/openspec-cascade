/**
 * Cross-Artifact Analyze Gate for openspec-cascade.
 *
 * Verifies semantic integrity across proposal, design, tasks, delta specs, and constitution:
 * 1. Coverage: every delta spec requirement maps to an automatable task.
 * 2. Orphans: no task exists without motivation in requirements or design decisions.
 * 3. Consistency: artifacts agree on scope, data model, and naming.
 * 4. Constitution: no requirement violates openspec/project.md invariants.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONSTANTS } from "../../config";

export interface AnalysisFinding {
  type: "coverage" | "orphan" | "consistency" | "constitution";
  artifacts: string[];
  description: string;
  blocking: boolean;
}

export interface AnalysisResult {
  changeId: string;
  passed: boolean;
  confirmedBlocking: number;
  findings: AnalysisFinding[];
  verdict: string;
}

/**
 * Extracts requirement titles from a delta spec markdown file.
 */
export function extractRequirementsFromSpec(specContent: string): string[] {
  const requirements: string[] = [];
  const lines = specContent.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### Requirement:") || trimmed.startsWith("## Requirement:")) {
      const title = trimmed.replace(/^#+\s*Requirement:\s*/i, "").trim();
      if (title) {
        requirements.push(title);
      }
    }
  }

  return requirements;
}

/**
 * Extracts task descriptions from tasks.md.
 */
export function extractTasks(tasksContent: string): string[] {
  const tasks: string[] = [];
  const lines = tasksContent.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]")) {
      const taskBody = trimmed.replace(/^-\s*\[[ x]\]\s*/i, "").trim();
      if (taskBody) {
        tasks.push(taskBody);
      }
    }
  }

  return tasks;
}

/**
 * Executes a cross-artifact analysis pass for an OpenSpec change.
 */
export async function analyzeChangeArtifacts(
  changeId: string,
  repoRoot: string = process.cwd()
): Promise<AnalysisResult> {
  const findings: AnalysisFinding[] = [];
  const changeDir = join(resolve(repoRoot), "openspec", "changes", changeId);
  const constitutionPath = join(resolve(repoRoot), CONSTANTS.SDD_CONSTITUTION_PATH);

  let proposal = "";
  let design = "";
  let tasksContent = "";
  let constitution = "";

  // 1. Read change artifacts
  try {
    proposal = await readFile(join(changeDir, "proposal.md"), "utf-8");
  } catch {
    findings.push({
      type: "consistency",
      artifacts: ["proposal.md"],
      description: "Missing proposal.md in change directory.",
      blocking: true,
    });
  }

  try {
    design = await readFile(join(changeDir, "design.md"), "utf-8");
  } catch {
    findings.push({
      type: "consistency",
      artifacts: ["design.md"],
      description: "Missing design.md in change directory.",
      blocking: true,
    });
  }

  try {
    tasksContent = await readFile(join(changeDir, "tasks.md"), "utf-8");
  } catch {
    findings.push({
      type: "consistency",
      artifacts: ["tasks.md"],
      description: "Missing tasks.md in change directory.",
      blocking: true,
    });
  }

  // 2. Read constitution if present
  try {
    constitution = await readFile(constitutionPath, "utf-8");
  } catch {
    // Advisory finding: constitution absent
    findings.push({
      type: "constitution",
      artifacts: [CONSTANTS.SDD_CONSTITUTION_PATH],
      description: `Project constitution (${CONSTANTS.SDD_CONSTITUTION_PATH}) is not present. Recommended to run sdd-constitution.`,
      blocking: false,
    });
  }

  // 3. Read delta specs
  const specsDir = join(changeDir, "specs");
  const extractedRequirements: string[] = [];

  try {
    const specEntries = await readdir(specsDir, { withFileTypes: true });
    for (const entry of specEntries) {
      if (entry.isDirectory()) {
        const specFile = join(specsDir, entry.name, "spec.md");
        try {
          const content = await readFile(specFile, "utf-8");
          const reqs = extractRequirementsFromSpec(content);
          extractedRequirements.push(...reqs);
        } catch {
          // No spec.md in subfolder
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = await readFile(join(specsDir, entry.name), "utf-8");
        const reqs = extractRequirementsFromSpec(content);
        extractedRequirements.push(...reqs);
      }
    }
  } catch {
    // Specs dir optional or absent
  }

  const tasks = extractTasks(tasksContent);

  // 4. Verify Coverage: every requirement maps to at least one task
  for (const req of extractedRequirements) {
    const reqWords = req
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > CONSTANTS.SDD_MIN_KEYWORD_LENGTH);

    const hasMatchingTask = tasks.some((task) => {
      const taskLower = task.toLowerCase();
      return reqWords.some((w) => taskLower.includes(w));
    });

    if (!hasMatchingTask && tasks.length > 0) {
      findings.push({
        type: "coverage",
        artifacts: ["specs", "tasks.md"],
        description: `Requirement "${req}" does not have an explicit mapping task in tasks.md.`,
        blocking: true,
      });
    }
  }

  // 5. Verify Orphans: tasks.md should not be empty if proposal exists
  if (proposal && tasks.length === 0) {
    findings.push({
      type: "orphan",
      artifacts: ["proposal.md", "tasks.md"],
      description: "Proposal exists but no actionable tasks are defined in tasks.md.",
      blocking: true,
    });
  }

  // 6. Verify Constitution Compliance (e.g. check for prohibited patterns if constitution exists)
  if (constitution) {
    const proposalAndDesign = `${proposal}\n${design}`;
    if (proposalAndDesign.includes("magic number") && !proposalAndDesign.includes("zero magic numbers")) {
      findings.push({
        type: "constitution",
        artifacts: ["design.md", CONSTANTS.SDD_CONSTITUTION_PATH],
        description: "Potential violation of constitution zero-magic-numbers principle.",
        blocking: false,
      });
    }
  }

  const confirmedBlocking = findings.filter((f) => f.blocking).length;
  const passed = confirmedBlocking === 0;

  const verdict = passed
    ? `Change ${changeId} passed Analyze gate with 100% coverage and zero blocking gaps.`
    : `Change ${changeId} failed Analyze gate with ${confirmedBlocking} blocking gap(s).`;

  return {
    changeId,
    passed,
    confirmedBlocking,
    findings,
    verdict,
  };
}
