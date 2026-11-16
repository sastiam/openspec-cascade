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
  { name: "cascade-spec-brainstorm", egmSkill: "egm-brainstorm", output: "brief.md", stamp: undefined },
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

  if (command.name === "cascade-spec-brainstorm") {
    test("scaffolds the change itself and tells propose to skip its already-exists creation step", () => {
      expect(text).toContain("openspec new change");
      expect(text).toContain("already exists");
      expect(text).toContain("/opsx-propose");
      expect(text).toContain("sdd-clarify");
    });

    test("requires subagents and skips scaffolding when reusing an existing change", () => {
      expect(text).toContain("create subagents");
      expect(text).toContain("skip step 2");
    });

    test("forbids EGM's publish-as-RFC option, which writes to docs/designs and SITEMAP.md", () => {
      expect(text).toMatch(/Do not offer or take .*Publish concepts_brief\.md as RFC/);
      expect(text).toContain("SITEMAP.md");
    });

    test("does not start Goldfish reviewers before the user confirms readiness", () => {
      expect(text).toContain("confirms");
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
  }
});
