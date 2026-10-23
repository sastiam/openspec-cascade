/**
 * In-repo skill discovery and context formatting module.
 *
 * Scans repository skills in `.agents/skills` and `.claude/skills`,
 * parses YAML frontmatter metadata, and formats an indexed catalog
 * for agent task prompt injection.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const SKILL_FILENAME = "SKILL.md";

export const SKILL_RELATIVE_DIRS = [
  [".agents", "skills"],
  [".claude", "skills"],
] as const;

export const DIRECTIVE_FILENAMES = ["AGENTS.md", "CLAUDE.md"] as const;

export const FRONTMATTER_DELIMITER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;

export interface InRepoSkill {
  name: string;
  description: string;
  path: string;
  body: string;
}

export interface ProjectDirective {
  name: string;
  path: string;
  content: string;
}

/**
 * Normalizes a relative path from the repository root to use forward slashes,
 * ensuring consistent paths across macOS, Linux, and Windows.
 */
function normalizeRelativePath(repoRoot: string, filePath: string): string {
  const rel = relative(repoRoot, filePath);
  return rel.split(sep).join("/");
}

/**
 * Finalizes a frontmatter value: joins multiline blocks, trims,
 * and removes matching outer quotes.
 */
function finalizeFrontmatterValue(values: string[], isFolded: boolean): string {
  let joined = isFolded ? values.join(" ") : values.join("\n");
  joined = joined.trim();
  if (
    (joined.startsWith('"') && joined.endsWith('"')) ||
    (joined.startsWith("'") && joined.endsWith("'"))
  ) {
    joined = joined.slice(1, -1);
  }
  return joined;
}

/**
 * Parses simple YAML key-value pairs from frontmatter text without third-party dependencies.
 */
function parseFrontmatterFields(frontmatter: string): Record<string, string> {
  const lines = frontmatter.split(/\r?\n/);
  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValues: string[] = [];
  let isFolded = false;

  for (const line of lines) {
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey) {
        fields[currentKey] = finalizeFrontmatterValue(currentValues, isFolded);
      }
      currentKey = keyMatch[1]!;
      const val = keyMatch[2]!.trim();
      if (val === ">" || val === ">-" || val === "|" || val === "|-" || val === "") {
        isFolded = val.startsWith(">");
        currentValues = [];
      } else {
        isFolded = false;
        currentValues = [val];
      }
    } else if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      currentValues.push(line.trim());
    }
  }

  if (currentKey) {
    fields[currentKey] = finalizeFrontmatterValue(currentValues, isFolded);
  }

  return fields;
}

/**
 * Parses raw skill markdown content, extracting frontmatter metadata and body.
 * Returns null if the content lacks valid YAML frontmatter or a valid `name`.
 */
export function parseSkill(rawContent: string, filePath = ""): InRepoSkill | null {
  if (!rawContent || typeof rawContent !== "string") {
    return null;
  }

  const match = rawContent.match(FRONTMATTER_DELIMITER_REGEX);
  if (!match) {
    return null;
  }

  const frontmatter = match[1] ?? "";
  const body = (match[2] ?? "").trim();

  const fields = parseFrontmatterFields(frontmatter);
  const name = fields["name"]?.trim();
  if (!name) {
    return null;
  }

  const description = fields["description"]?.trim() || "";

  return {
    name,
    description,
    path: filePath,
    body,
  };
}

/**
 * Discovers in-repo skills under `.agents/skills/*\/SKILL.md` and `.claude/skills/*\/SKILL.md`.
 * Fails gracefully (returns empty array) if directories cannot be read or do not exist.
 */
export function discoverSkills(repoRoot: string): InRepoSkill[] {
  const skills: InRepoSkill[] = [];
  const seenNames = new Set<string>();

  for (const dirParts of SKILL_RELATIVE_DIRS) {
    const dir = resolve(repoRoot, ...dirParts);
    if (!existsSync(dir)) {
      continue;
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        let isDir = entry.isDirectory();
        const entryPath = join(dir, entry.name);

        if (!isDir && entry.isSymbolicLink()) {
          try {
            isDir = statSync(entryPath).isDirectory();
          } catch {
            isDir = false;
          }
        }

        if (!isDir) {
          continue;
        }

        const skillPath = join(entryPath, SKILL_FILENAME);
        if (!existsSync(skillPath)) {
          continue;
        }

        try {
          const content = readFileSync(skillPath, "utf-8");
          const relPath = normalizeRelativePath(repoRoot, skillPath);
          const skill = parseSkill(content, relPath);
          if (skill && !seenNames.has(skill.name)) {
            seenNames.add(skill.name);
            skills.push(skill);
          }
        } catch {
          // Gracefully ignore individual unreadable files
        }
      }
    } catch {
      // Gracefully ignore directory read errors
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Formats a list of discovered skills into an indexed XML-tagged catalog
 * suitable for appending to an AI agent's initial prompt.
 */
export function formatSkillsPrompt(skills: InRepoSkill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const lines = [
    "<skills>",
    "Repository-specific skills are available to assist with this task:",
    ...skills.map((skill) => {
      const desc = skill.description ? `: ${skill.description}` : "";
      return `- ${skill.name} (${skill.path})${desc}`;
    }),
    "Use your file reading tool to inspect any skill file if relevant to the current task.",
    "</skills>",
  ];

  return lines.join("\n");
}

/**
 * Discovers project-level directive files (AGENTS.md, CLAUDE.md) in the repository root.
 * Returns empty array if none exist or cannot be read.
 */
export function discoverDirectives(repoRoot: string): ProjectDirective[] {
  const directives: ProjectDirective[] = [];

  for (const filename of DIRECTIVE_FILENAMES) {
    const fullPath = resolve(repoRoot, filename);
    if (!existsSync(fullPath)) {
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8").trim();
      if (content.length > 0) {
        directives.push({
          name: filename,
          path: normalizeRelativePath(repoRoot, fullPath),
          content,
        });
      }
    } catch {
      // Graceful error handling
    }
  }

  return directives;
}

/**
 * Formats discovered project directives into an XML-tagged block
 * suitable for appending to an AI agent's initial prompt as project-wide constraints.
 */
export function formatDirectivesPrompt(directives: ProjectDirective[]): string {
  if (directives.length === 0) {
    return "";
  }

  const lines = [
    "<project-directives>",
    "Project-wide directives and constraints:",
    ...directives.map(
      (directive) => `<directive file="${directive.name}">\n${directive.content}\n</directive>`,
    ),
    "</project-directives>",
  ];

  return lines.join("\n");
}

