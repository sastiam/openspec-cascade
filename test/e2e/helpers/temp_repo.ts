import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { getDefaultSpawner } from "../../../src/runtime/spawner";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { E2E_CONSTANTS } from "./constants";

export type PackageLockfileName =
  | "pnpm-lock.yaml"
  | "package-lock.json"
  | "yarn.lock"
  | "bun.lock"
  | "bun.lockb";

export interface SkillFixtureSpec {
  name: string;
  description: string;
  body?: string;
  location?: "agents" | "claude";
}

export interface DirectiveFixtureSpec {
  filename: "AGENTS.md" | "CLAUDE.md";
  content: string;
}

export interface TempGitRepoOptions {
  branch?: string;
  files?: Record<string, string>;
  dirtyFiles?: Record<string, string>;
  lockfiles?: readonly PackageLockfileName[];
  skills?: readonly SkillFixtureSpec[];
  directives?: readonly DirectiveFixtureSpec[];
  packageJson?: Record<string, unknown>;
}

export interface TempGitRepo {
  repoDir: string;
  homeDir: string;
  logDir: string;
  branch: string;
  initialSha: string;
  cleanup: () => void;
}

export interface OpenSpecChangeOptions {
  tasksMarkdown?: string;
  proposalMarkdown?: string;
  designMarkdown?: string;
  specMarkdown?: string;
  capabilitySlug?: string;
  includeConstitution?: boolean;
  includeProposal?: boolean;
  includeDesign?: boolean;
  includeTasks?: boolean;
  includeSpec?: boolean;
}

export interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Executes a git command inside an isolated repository directory.
 */
export async function runGitCommand(
  repoDir: string,
  args: readonly string[],
): Promise<GitCommandResult> {
  const result = await getDefaultSpawner().run(["git", ...args], { cwd: repoDir });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function writeRelativeFile(baseDir: string, relativePath: string, content: string): void {
  const targetPath = resolve(baseDir, relativePath);
  const parentDir = dirname(targetPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  writeFileSync(targetPath, content, "utf8");
}

async function runGitOrThrow(repoDir: string, args: readonly string[]): Promise<string> {
  const result = await runGitCommand(repoDir, args);
  if (result.exitCode !== E2E_CONSTANTS.EXIT_CODE_SUCCESS) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Safely deletes a temporary directory created during E2E test execution.
 */
export function cleanupTempDir(dirPath: string): void {
  if (existsSync(dirPath)) {
    rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Creates an isolated temporary git repository with initial commit, local author config,
 * optional lockfiles, skills, directives, and dirty files. Fixture commits are unsigned
 * (`commit.gpgsign false`) so they do not depend on the developer's signing key, which is
 * unreadable inside the night-run sandbox.
 */
export async function createTempGitRepo(
  options: TempGitRepoOptions = {},
): Promise<TempGitRepo> {
  const repoDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_REPO));
  const homeDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_HOME));
  const logDir = mkdtempSync(join(tmpdir(), E2E_CONSTANTS.TEMP_PREFIX_LOGS));
  const branch = options.branch ?? E2E_CONSTANTS.DEFAULT_BRANCH;

  const cleanup = (): void => {
    cleanupTempDir(repoDir);
    cleanupTempDir(homeDir);
    cleanupTempDir(logDir);
  };

  try {
    await runGitOrThrow(repoDir, ["init"]);
    await runGitOrThrow(repoDir, ["checkout", "-B", branch]);
    await runGitOrThrow(repoDir, ["config", "user.name", E2E_CONSTANTS.DEFAULT_GIT_USER_NAME]);
    await runGitOrThrow(repoDir, ["config", "user.email", E2E_CONSTANTS.DEFAULT_GIT_USER_EMAIL]);
    await runGitOrThrow(repoDir, ["config", "commit.gpgsign", "false"]);

    writeRelativeFile(repoDir, "README.md", "# E2E Fixture Repository\n");

    if (options.packageJson !== undefined) {
      writeRelativeFile(
        repoDir,
        "package.json",
        `${JSON.stringify(options.packageJson, null, E2E_CONSTANTS.JSON_INDENT_SPACES)}\n`,
      );
    }

    if (options.lockfiles) {
      for (const lockfile of options.lockfiles) {
        writeRelativeFile(repoDir, lockfile, "# lockfile fixture\n");
      }
    }

    if (options.files) {
      for (const [relPath, content] of Object.entries(options.files)) {
        writeRelativeFile(repoDir, relPath, content);
      }
    }

    if (options.skills) {
      for (const skill of options.skills) {
        const rootFolder = skill.location === "claude" ? ".claude" : ".agents";
        const body = skill.body ?? `Instructions for ${skill.name}.\n`;
        const content = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${body}`;
        writeRelativeFile(repoDir, join(rootFolder, "skills", skill.name, "SKILL.md"), content);
      }
    }

    if (options.directives) {
      for (const directive of options.directives) {
        writeRelativeFile(repoDir, directive.filename, directive.content);
      }
    }

    await runGitOrThrow(repoDir, ["add", "-A"]);
    await runGitOrThrow(repoDir, ["commit", "-m", E2E_CONSTANTS.INITIAL_COMMIT_MESSAGE]);
    const initialSha = await runGitOrThrow(repoDir, ["rev-parse", "HEAD"]);

    if (options.dirtyFiles) {
      for (const [relPath, content] of Object.entries(options.dirtyFiles)) {
        writeRelativeFile(repoDir, relPath, content);
      }
    }

    return {
      repoDir,
      homeDir,
      logDir,
      branch,
      initialSha,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Scaffolds an OpenSpec change directory compliant with strict OpenSpec validation
 * and cross-artifact Analyze gate requirements.
 */
export function addOpenSpecChange(
  repoDir: string,
  changeId: string,
  options: OpenSpecChangeOptions = {},
): string {
  const openspecDir = join(repoDir, "openspec");
  const changeDir = join(openspecDir, "changes", changeId);
  const capabilitySlug = options.capabilitySlug ?? "core-behavior";

  writeRelativeFile(openspecDir, "config.yaml", "schema: spec-driven\n");
  mkdirSync(join(openspecDir, "specs"), { recursive: true });
  mkdirSync(changeDir, { recursive: true });

  writeRelativeFile(changeDir, ".openspec.yaml", "schema: spec-driven\ncreated: 2026-11-15\n");

  if (options.includeConstitution) {
    writeRelativeFile(
      openspecDir,
      "project.md",
      [
        "# OpenSpec Fixture Constitution",
        "",
        "## Core Principles",
        "1. Spec before code.",
        "2. Zero magic numbers and strict TypeScript typing.",
        "",
      ].join("\n"),
    );
  }

  if (options.includeProposal !== false) {
    const proposalContent =
      options.proposalMarkdown ??
      [
        `# Proposal: ${changeId}`,
        "",
        "## Why",
        `Provides deterministic behavior for ${changeId}.`,
        "",
        "## What Changes",
        `- Implements ${capabilitySlug} module and verification tasks.`,
        "",
      ].join("\n");
    writeRelativeFile(changeDir, "proposal.md", proposalContent);
  }

  if (options.includeDesign !== false) {
    const designContent =
      options.designMarkdown ??
      [
        `# Design: ${changeId}`,
        "",
        "## Context",
        `Architectural design for ${changeId}.`,
        "",
        "## Decisions",
        `- Keep ${capabilitySlug} isolated and deterministic.`,
        "",
      ].join("\n");
    writeRelativeFile(changeDir, "design.md", designContent);
  }

  if (options.includeTasks !== false) {
    const tasksContent =
      options.tasksMarkdown ??
      [
        "## 1. Implementation",
        "",
        `- [ ] 1.1 Implement deterministic ${capabilitySlug} execution behavior`,
        "  Verify: `bun test`",
        `- [ ] 1.2 Run the tests. Commit \`feat(${capabilitySlug})\``,
        "  Verify: `bun test`",
        "",
      ].join("\n");
    writeRelativeFile(changeDir, "tasks.md", tasksContent);
  }

  if (options.includeSpec !== false) {
    const specContent =
      options.specMarkdown ??
      [
        "## ADDED Requirements",
        "",
        `### Requirement: Deterministic ${capabilitySlug} execution`,
        `The harness SHALL execute ${capabilitySlug} behavior deterministically in isolation.`,
        "",
        "#### Scenario: Isolated fixture execution",
        "- **WHEN** the harness executes the task",
        "- **THEN** it completes with zero side effects outside the fixture",
        "",
      ].join("\n");
    writeRelativeFile(changeDir, join("specs", capabilitySlug, "spec.md"), specContent);
  }

  return changeDir;
}
