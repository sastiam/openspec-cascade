import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Content checks for the EGM wrapper commands. They are Markdown prompts, so the only verifiable
 * contract is what the prompt tells the agent: where outputs go, which EGM skill it follows and how it closes the stage.
 */
const COMMANDS_DIR = join(import.meta.dir, "..", "..", "plugins", "cascade", "commands");

interface EgmCommand {
  readonly name: string;
  readonly egmSkill: string;
  readonly output: string;
  readonly stamp: string | undefined;
}

const COMMANDS: EgmCommand[] = [
  { name: "cascade-spec-review", egmSkill: "egm-review", output: "review.md", stamp: "spec-gate stamp --stage review" },
  { name: "cascade-spec-drift", egmSkill: "egm-drift-report", output: "drift.md", stamp: "spec-gate stamp --stage drift" },
  { name: "explore", egmSkill: "egm-brainstorm", output: "brief.md", stamp: undefined },
];

function read(name: string): string {
  return readFileSync(join(COMMANDS_DIR, `${name}.md`), "utf8");
}

describe.each(COMMANDS)("$name", (command) => {
  const text = read(command.name);

  test("has frontmatter whose name matches the file and a description", () => {
    expect(text).toMatch(new RegExp(`^---\\nname: ${command.name}\\n`));
    expect(text).toMatch(/\ndescription: \S/);
  });

  test("names OpenSpec skills for Claude Code and OpenCode, never the old /opsx commands", () => {
    expect(text).not.toMatch(/\/opsx[:-]/);
    const skills = [...text.matchAll(/\/(openspec-[a-z-]+)/g)].map((m) => m[1]);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) expect(text).toContain(`@${skill}`);
  });

  test("writes only inside the change folder; docs/designs is mentioned only as forbidden", () => {
    expect(text).toContain("openspec/changes/<change>/");
    expect(text).toContain(command.output);
    const mentions = text.split("\n").filter((line) => line.includes("docs/designs/"));
    for (const line of mentions) expect(line).toContain("never");
  });

  test("follows the installed EGM skill by reading it, not through the Skill tool", () => {
    expect(text).toContain(`skills/${command.egmSkill}/SKILL.md`);
    expect(text).toContain("docs/claude.md");
    expect(text).toContain("egm@egm");
    expect(text).toContain("EGM artifact directory: openspec/changes/<change>");
  });

  if (command.name === "explore") {
    const wholeLines = (headings: string[]): number[] => {
      const lines = text.split("\n");
      let from = 0;
      return headings.map((heading) => {
        const index = lines.indexOf(heading, from);
        from = index + 1;
        return index;
      });
    };

    test("frontmatter leaves model invocation enabled", () => {
      expect(text).not.toContain("disable-model-invocation");
    });

    test("has the section headings as whole lines in order", () => {
      const headings = [
        "## Usage",
        "## Preconditions",
        "## Precedence and overrides",
        "## Load context",
        "## Read-only investigation",
        "### Read-only allowlist",
        "### The command's own writes",
        "## Readiness gate",
      ];
      const indexes = wholeLines(headings);
      for (const index of indexes) expect(index).toBeGreaterThan(-1);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    });

    test("states usage and preconditions", () => {
      for (const literal of [
        "/cascade:explore <change> <idea or Linear link>",
        "already has tasks.md",
        "Claude Code only",
        "@openspec-explore",
        "sdd-clarify",
        "openspec list --json",
        "skills/openspec-explore/SKILL.md",
        "openspec-cascade setup show --json",
        "no manifest",
        "already exists",
        "without running `openspec new change`",
      ]) {
        expect(text).toContain(literal);
      }
    });

    test("states the precedence and the overrides", () => {
      for (const literal of [
        "Cascade overrides > EGM brainstorm skill > openspec-propose skill > openspec-explore skill",
        "Do not stop after the artifacts",
        "Do not present the apply prompt",
        "/openspec-propose",
        "@openspec-propose",
        "EGM artifact directory: openspec/changes/<change>",
        "openspec/changes/<change>/brief.md",
        "egm-draft",
        "SITEMAP.md",
      ]) {
        expect(text).toContain(literal);
      }
      expect(text).toMatch(/Do not offer or take .*Publish concepts_brief\.md as RFC/);
    });

    test("loads config, Linear and the manifest", () => {
      for (const literal of ["openspec/config.yaml", "Linear MCP", "paste"]) expect(text).toContain(literal);
    });

    test("lists the read-only allowlist, its exclusions and the command's own writes", () => {
      for (const literal of [
        "--profile",
        "`name`",
        "`aws`",
        "`type`",
        "`cli`",
        "secretsmanager",
        "--with-decryption",
        "kms decrypt",
        "authorization-token",
        "login-password",
        "sts get-",
        "sts assume-role",
        "lambda get-function",
        "get-function-configuration",
        "ecs describe-task-definition",
        "s3api get-object",
        "gh run list --limit",
        "gh run view --log-failed",
        "gh workflow view",
        "get_",
        "list_",
        "search_",
        "openspec new change",
        "IAM",
      ]) {
        expect(text).toContain(literal);
      }
    });

    test("requires the deploy and CI inventory and a bounded context", () => {
      for (const literal of [".github/workflows/", "--max-items", "one question per message", "account IDs", "ARNs"]) {
        expect(text).toContain(literal);
      }
    });

    test("gates the Goldfish review on confirmation and a late EGM check", () => {
      for (const literal of [
        "skills/egm-brainstorm/SKILL.md",
        "docs/claude.md",
        "egm@egm",
        "Goldfish",
        "confirms",
        "create subagents",
      ]) {
        expect(text).toContain(literal);
      }
    });

    test("has the closing section headings after the readiness gate", () => {
      const headings = [
        "## Readiness gate",
        "## Write brief.md",
        "## Propose",
        "## Readiness check and fix loop",
        "## Report",
      ];
      const indexes = wholeLines(headings);
      for (const index of indexes) expect(index).toBeGreaterThan(-1);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    });

    test("holds the brief template as one markdown fence with each heading once", () => {
      const lines = text.split("\n");
      const briefHeadings = [
        "## Overview",
        "## Sources consulted",
        "## Findings",
        "## Deploy and CI risks",
        "## Manual steps",
        "## Goals and Non-Goals",
        "## Alternatives weighed",
        "## Decisions",
        "## Open questions",
      ];
      const start = lines.indexOf("## Write brief.md");
      const end = lines.indexOf("## Propose");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(lines.slice(start, end)).toContain("```markdown");
      const indexes = wholeLines(briefHeadings);
      for (const [position, heading] of briefHeadings.entries()) {
        expect(indexes[position]).toBeGreaterThan(start);
        expect(indexes[position]).toBeLessThan(end);
        expect(lines.filter((line) => line === heading)).toHaveLength(1);
      }
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    });

    test("proposes inline and writes manual.md without checkboxes", () => {
      for (const literal of ["manual.md", "Check:", "no checkboxes", "skip its creation step"]) {
        expect(text).toContain(literal);
      }
    });

    test("runs the readiness check, the bounded fix loop and the tooling stop", () => {
      for (const literal of [
        "openspec validate <change> --strict",
        "openspec-cascade lint-tasks --changes <change>",
        "--repo",
        "exit 1",
        "exit 2",
        "command not found",
        "at most 3",
        "any artifact",
        "/openspec-update-change",
        "@openspec-update-change",
        "Update openspec-cascade (forja apply looper) and run /cascade:explore <change> again.",
        "ready for an unattended run",
        "/cascade:cascade-spec-review",
      ]) {
        expect(text).toContain(literal);
      }
    });
  }

  if (command.stamp !== undefined) {
    test("closes the stage with spec-gate stamp", () => {
      expect(text).toContain(command.stamp ?? "");
    });

    test("stamps open right after writing the report, so a re-run never keeps an old resolved stamp", () => {
      const openStamp = text.indexOf(`${command.stamp} --change <change> --status open`);
      expect(openStamp).toBeGreaterThan(-1);
      expect(text.slice(0, openStamp).toLowerCase()).toContain("immediately");
    });
  }

  if (command.name === "cascade-spec-review") {
    test("always writes review.md and forbids the egm-resolve shortcut", () => {
      expect(text).toContain("always write");
      expect(text).toContain("egm-resolve");
    });

    test("requires a tasks.md that passes the tasks linter, with a fixed upgrade sentence and no override", () => {
      for (const literal of [
        "If `tasks.md` is missing",
        "openspec-cascade lint-tasks --changes <change>",
        "exit 1",
        "exit 2",
        "command not found",
        "Update openspec-cascade (forja apply looper) and run /cascade:cascade-spec-review <change> again.",
      ]) {
        expect(text).toContain(literal);
      }
      const order = ["design.md` exists", "If `tasks.md` is missing", "exit 1", "exit 2", "The EGM plugin is installed"];
      const positions = order.map((literal) => text.indexOf(literal));
      for (const position of positions) expect(position).toBeGreaterThan(-1);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
  }
});

describe("cascade-spec-brainstorm alias", () => {
  const text = read("cascade-spec-brainstorm");
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");

  test("keeps its frontmatter and delegates to explore", () => {
    for (const literal of [
      "name: cascade-spec-brainstorm",
      "description: Deprecated alias for /cascade:explore",
      "category:",
      "tags:",
      "/cascade:explore $ARGUMENTS",
    ]) {
      expect(text).toContain(literal);
    }
  });

  test("has a one-line body without headings", () => {
    const lines = body.split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(body.split("\n").some((line) => line.startsWith("#"))).toBe(false);
  });

  test("never names the old /opsx commands", () => {
    expect(text).not.toMatch(/\/opsx/);
  });
});
