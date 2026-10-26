import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type InRepoSkill,
  discoverDirectives,
  discoverSkills,
  formatDirectivesPrompt,
  formatSkillsPrompt,
  parseSkill,
} from "./skills";

describe("parseSkill", () => {
  it("parses valid frontmatter with name, description, and body", () => {
    const raw = `---
name: test-skill
description: A helpful test skill.
---

# Test Skill
This is the markdown body of the skill.`;

    const parsed = parseSkill(raw, ".agents/skills/test-skill/SKILL.md");
    expect(parsed).toEqual({
      name: "test-skill",
      description: "A helpful test skill.",
      path: ".agents/skills/test-skill/SKILL.md",
      body: "# Test Skill\nThis is the markdown body of the skill.",
    });
  });

  it("handles double and single quoted frontmatter values", () => {
    const rawDouble = `---
name: "double-quoted"
description: "Description in double quotes"
---
Body text`;

    const parsedDouble = parseSkill(rawDouble);
    expect(parsedDouble?.name).toBe("double-quoted");
    expect(parsedDouble?.description).toBe("Description in double quotes");

    const rawSingle = `---
name: 'single-quoted'
description: 'Description in single quotes'
---
Body text`;

    const parsedSingle = parseSkill(rawSingle);
    expect(parsedSingle?.name).toBe("single-quoted");
    expect(parsedSingle?.description).toBe("Description in single quotes");
  });

  it("preserves quotes embedded inside the description text", () => {
    const raw = `---
name: embedded-quotes
description: Use when user says "openspec apply" or 'apply'.
---
Body text`;

    const parsed = parseSkill(raw);
    expect(parsed?.description).toBe('Use when user says "openspec apply" or \'apply\'.');
  });

  it("handles multiline and folded YAML descriptions", () => {
    const rawFolded = `---
name: folded-skill
description: >
  First line of description
  second line of description
---
Body`;

    const parsedFolded = parseSkill(rawFolded);
    expect(parsedFolded?.description).toBe("First line of description second line of description");

    const rawBlock = `---
name: block-skill
description: |
  Line 1
  Line 2
---
Body`;

    const parsedBlock = parseSkill(rawBlock);
    expect(parsedBlock?.description).toBe("Line 1\nLine 2");
  });

  it("handles Windows CRLF line endings in frontmatter and body", () => {
    const rawCrlf = "---\r\nname: crlf-skill\r\ndescription: CRLF description\r\n---\r\n# CRLF Header\r\nCRLF body";

    const parsed = parseSkill(rawCrlf);
    expect(parsed).toEqual({
      name: "crlf-skill",
      description: "CRLF description",
      path: "",
      body: "# CRLF Header\r\nCRLF body",
    });
  });

  it("ignores extra frontmatter metadata fields", () => {
    const raw = `---
name: extra-fields
description: Has extra metadata
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires CLI
metadata:
  author: tester
  version: "1.0"
---
Body`;

    const parsed = parseSkill(raw);
    expect(parsed?.name).toBe("extra-fields");
    expect(parsed?.description).toBe("Has extra metadata");
    expect(parsed?.body).toBe("Body");
  });

  it("returns null when frontmatter delimiters are missing", () => {
    expect(parseSkill("# Markdown without frontmatter")).toBeNull();
    expect(parseSkill("")).toBeNull();
  });

  it("returns null when name is missing or empty", () => {
    const noName = `---
description: Missing name field
---
Body`;
    expect(parseSkill(noName)).toBeNull();

    const emptyName = `---
name:
description: Empty name
---
Body`;
    expect(parseSkill(emptyName)).toBeNull();
  });

  it("defaults description to empty string if missing", () => {
    const noDesc = `---
name: only-name
---
Body`;
    const parsed = parseSkill(noDesc);
    expect(parsed?.name).toBe("only-name");
    expect(parsed?.description).toBe("");
  });
});

describe("discoverSkills", () => {
  it("returns empty array when repoRoot does not exist", () => {
    expect(discoverSkills("/nonexistent/repo/path/xyz123")).toEqual([]);
  });

  it("returns empty array when no skill directories exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-empty-"));
    try {
      expect(discoverSkills(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("discovers skills in .agents/skills and .claude/skills and sorts alphabetically", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-discover-"));
    try {
      // Create .agents/skills/beta-skill/SKILL.md
      const agentsBeta = join(tmp, ".agents", "skills", "beta-skill");
      mkdirSync(agentsBeta, { recursive: true });
      writeFileSync(
        join(agentsBeta, "SKILL.md"),
        `---
name: beta-skill
description: Beta skill description
---
Beta body`,
      );

      // Create .agents/skills/alpha-skill/SKILL.md
      const agentsAlpha = join(tmp, ".agents", "skills", "alpha-skill");
      mkdirSync(agentsAlpha, { recursive: true });
      writeFileSync(
        join(agentsAlpha, "SKILL.md"),
        `---
name: alpha-skill
description: Alpha skill description
---
Alpha body`,
      );

      // Create .claude/skills/gamma-skill/SKILL.md
      const claudeGamma = join(tmp, ".claude", "skills", "gamma-skill");
      mkdirSync(claudeGamma, { recursive: true });
      writeFileSync(
        join(claudeGamma, "SKILL.md"),
        `---
name: gamma-skill
description: Gamma skill description
---
Gamma body`,
      );

      const skills = discoverSkills(tmp);
      expect(skills.map((s) => s.name)).toEqual(["alpha-skill", "beta-skill", "gamma-skill"]);
      expect(skills[0]?.path).toBe(".agents/skills/alpha-skill/SKILL.md");
      expect(skills[1]?.path).toBe(".agents/skills/beta-skill/SKILL.md");
      expect(skills[2]?.path).toBe(".claude/skills/gamma-skill/SKILL.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("deduplicates skills by name with .agents taking precedence over .claude", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-dedup-"));
    try {
      const agentsDir = join(tmp, ".agents", "skills", "duplicate-skill");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "SKILL.md"),
        `---
name: duplicate-skill
description: From .agents/skills
---
Agents body`,
      );

      const claudeDir = join(tmp, ".claude", "skills", "duplicate-skill");
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(
        join(claudeDir, "SKILL.md"),
        `---
name: duplicate-skill
description: From .claude/skills
---
Claude body`,
      );

      const skills = discoverSkills(tmp);
      expect(skills.length).toBe(1);
      expect(skills[0]?.name).toBe("duplicate-skill");
      expect(skills[0]?.description).toBe("From .agents/skills");
      expect(skills[0]?.path).toBe(".agents/skills/duplicate-skill/SKILL.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips non-directories, directories without SKILL.md, and invalid skills", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-skip-"));
    try {
      const skillsDir = join(tmp, ".agents", "skills");
      mkdirSync(skillsDir, { recursive: true });

      // Non-directory file in skills dir
      writeFileSync(join(skillsDir, ".openspec-target"), "target content");

      // Directory without SKILL.md
      mkdirSync(join(skillsDir, "empty-dir"), { recursive: true });

      // Directory with invalid SKILL.md (missing name)
      const invalidDir = join(skillsDir, "invalid-skill");
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, "SKILL.md"), "# No frontmatter");

      // Valid skill
      const validDir = join(skillsDir, "valid-skill");
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, "SKILL.md"),
        `---
name: valid-skill
description: Valid skill
---
Body`,
      );

      const skills = discoverSkills(tmp);
      expect(skills.length).toBe(1);
      expect(skills[0]?.name).toBe("valid-skill");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("discovers existing repo skills in openspec-cascade", () => {
    const repoSkills = discoverSkills(process.cwd());
    expect(repoSkills.length).toBeGreaterThanOrEqual(7);

    const names = repoSkills.map((s) => s.name);
    expect(names).toContain("openspec-cascade-runner");
    expect(names).toContain("openspec-apply-change");
    expect(names).toContain("openspec-explore");
    expect(names).toContain("openspec-propose");
  });
});

describe("formatSkillsPrompt", () => {
  it("returns empty string when skills array is empty", () => {
    expect(formatSkillsPrompt([])).toBe("");
  });

  it("formats single skill into XML catalog", () => {
    const skills: InRepoSkill[] = [
      {
        name: "openspec-cascade-runner",
        description: "Quality standards and architecture rules.",
        path: ".agents/skills/openspec-cascade-runner/SKILL.md",
        body: "body",
      },
    ];

    const prompt = formatSkillsPrompt(skills);
    expect(prompt).toBe(
      [
        "<skills>",
        "Repository-specific skills are available to assist with this task:",
        "- openspec-cascade-runner (.agents/skills/openspec-cascade-runner/SKILL.md): Quality standards and architecture rules.",
        "Use your file reading tool to inspect any skill file if relevant to the current task.",
        "</skills>",
      ].join("\n"),
    );
  });

  it("formats multiple skills matching the design catalog format", () => {
    const skills: InRepoSkill[] = [
      {
        name: "openspec-cascade-runner",
        description:
          "Quality standards, architecture principles, in-repo skill usage, and QA verification rules for AI agents executing within openspec-cascade.",
        path: ".agents/skills/openspec-cascade-runner/SKILL.md",
        body: "",
      },
      {
        name: "openspec-apply-change",
        description: "Implement tasks from an OpenSpec change.",
        path: ".agents/skills/openspec-apply-change/SKILL.md",
        body: "",
      },
    ];

    const prompt = formatSkillsPrompt(skills);
    expect(prompt).toBe(
      [
        "<skills>",
        "Repository-specific skills are available to assist with this task:",
        "- openspec-cascade-runner (.agents/skills/openspec-cascade-runner/SKILL.md): Quality standards, architecture principles, in-repo skill usage, and QA verification rules for AI agents executing within openspec-cascade.",
        "- openspec-apply-change (.agents/skills/openspec-apply-change/SKILL.md): Implement tasks from an OpenSpec change.",
        "Use your file reading tool to inspect any skill file if relevant to the current task.",
        "</skills>",
      ].join("\n"),
    );
  });

  it("formats skill without description cleanly", () => {
    const skills: InRepoSkill[] = [
      {
        name: "no-desc-skill",
        description: "",
        path: ".agents/skills/no-desc-skill/SKILL.md",
        body: "",
      },
    ];

    const prompt = formatSkillsPrompt(skills);
    expect(prompt).toContain("- no-desc-skill (.agents/skills/no-desc-skill/SKILL.md)\n");
  });
});

describe("discoverDirectives", () => {
  it("returns empty array when directive files do not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "directives-empty-"));
    try {
      expect(discoverDirectives(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("discovers AGENTS.md and CLAUDE.md when present", () => {
    const tmp = mkdtempSync(join(tmpdir(), "directives-exist-"));
    try {
      writeFileSync(join(tmp, "AGENTS.md"), "# Project Agent Rules\nFollow guidelines.");
      writeFileSync(join(tmp, "CLAUDE.md"), "# Claude Rules\nFollow conventions.");

      const directives = discoverDirectives(tmp);
      expect(directives.length).toBe(2);
      expect(directives[0]?.name).toBe("AGENTS.md");
      expect(directives[0]?.content).toBe("# Project Agent Rules\nFollow guidelines.");
      expect(directives[1]?.name).toBe("CLAUDE.md");
      expect(directives[1]?.content).toBe("# Claude Rules\nFollow conventions.");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips empty directive files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "directives-whitespace-"));
    try {
      writeFileSync(join(tmp, "AGENTS.md"), "   \n\n   ");
      expect(discoverDirectives(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("formatDirectivesPrompt", () => {
  it("returns empty string when directives array is empty", () => {
    expect(formatDirectivesPrompt([])).toBe("");
  });

  it("formats single directive into XML block", () => {
    const directives = [
      {
        name: "AGENTS.md",
        path: "AGENTS.md",
        content: "# Agent Guidelines\nAlways write tests.",
      },
    ];

    const prompt = formatDirectivesPrompt(directives);
    expect(prompt).toBe(
      [
        "<project-directives>",
        "Project-wide directives and constraints:",
        '<directive file="AGENTS.md">',
        "# Agent Guidelines\nAlways write tests.",
        "</directive>",
        "</project-directives>",
      ].join("\n"),
    );
  });

  it("formats multiple directives in order", () => {
    const directives = [
      {
        name: "AGENTS.md",
        path: "AGENTS.md",
        content: "Rule 1: No bugs.",
      },
      {
        name: "CLAUDE.md",
        path: "CLAUDE.md",
        content: "Rule 2: Typecheck.",
      },
    ];

    const prompt = formatDirectivesPrompt(directives);
    expect(prompt).toContain('<directive file="AGENTS.md">\nRule 1: No bugs.\n</directive>');
    expect(prompt).toContain('<directive file="CLAUDE.md">\nRule 2: Typecheck.\n</directive>');
    expect(prompt.startsWith("<project-directives>\nProject-wide directives and constraints:\n")).toBe(true);
    expect(prompt.endsWith("</project-directives>")).toBe(true);
  });
});
