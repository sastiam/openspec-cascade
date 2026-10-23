import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blockedReason,
  commitsPerSection,
  commitTypeOf,
  isKeepAliveEnabled,
  isLastOfSection,
  parseTasks,
  resolveEngine,
  taskPrompt,
  verifyCommands,
  type Task,
} from "./cascade";

const numbered = `## 1. Docs

- [ ] 1.1 Commit \`docs/platform-vision/\` and this OpenSpec change (\`docs\` commit)

## 3. Server

- [x] 3.8 Done already
- [ ] 3.9 Verify: \`bun test\`, \`bun run lint\`, \`bun run build\`, both \`tsc\` programs, and
  \`bun run db:generate\` produces no new migration. Commit \`refactor(server)\`
- [ ] 1.1 Verify \`retire-legacy-spa-panel\` is complete and merged into the working branch
`;

const bold = `### Dependency batches (one commit per batch)

- [ ] **T013**: Framework batch — upgrade nuxt, vue, vue-router. Run full verification.
- [ ] **T019**: Remove \`docs/platform-vision/\` directory (all files).
`;

describe("parseTasks", () => {
  test("parses numbered ids, done state and continuation lines", () => {
    const tasks = parseTasks(numbered);
    expect(tasks.map((t) => [t.id, t.done])).toEqual([["1.1", false], ["3.8", true], ["3.9", false], ["1.1", false]]);
    expect(tasks[2]!.text).toContain("produces no new migration. Commit `refactor(server)`");
  });

  test("parses bold T-ids", () => {
    expect(parseTasks(bold).map((t) => t.id)).toEqual(["T013", "T019"]);
  });
});

describe("commitTypeOf", () => {
  test("ignores code spans that are paths and keeps the conventional type", () => {
    const [docs, , server] = parseTasks(numbered);
    expect(commitTypeOf(docs!)).toBe("docs");
    expect(commitTypeOf(server!)).toBe("refactor(server)");
  });

  test("changes without commit markers commit once per section, at its last task", () => {
    const tasks = parseTasks(bold);
    expect(commitsPerSection(tasks)).toBe(true);
    expect(commitsPerSection(parseTasks(numbered))).toBe(false);
    expect(isLastOfSection(tasks, tasks[0]!)).toBe(false);
    expect(isLastOfSection(tasks, tasks[1]!)).toBe(true);
  });
});

describe("verifyCommands", () => {
  test("asserts db:generate leaves no new migration", () => {
    const commands = verifyCommands(parseTasks(numbered)[2]!);
    expect(commands[0]).toBe("bunx nuxi prepare");
    expect(commands.some((c) => c.startsWith("bun run db:generate || exit 1"))).toBe(true);
    expect(commands).toContain("bunx tsc --noEmit -p .nuxt/tsconfig.app.json");
  });

  test("'Verify X is complete' without a colon is a normal task", () => {
    expect(verifyCommands(parseTasks(numbered)[3]!)).toEqual([]);
  });

  test("'Run full verification' expands to the full suite", () => {
    const commands = verifyCommands(parseTasks(bold)[0]!);
    expect(commands).toContain("bun run test:e2e");
    expect(commands).toContain("bunx tsc --noEmit -p .nuxt/tsconfig.server.json");
  });
});

describe("verifyCommands on dependency tasks", () => {
  const deps = `## 1. Security fixes

- [ ] 1.1 Upgrade \`next-auth\` to \`4.24.15\`. Verify: \`bun audit\` shows 0 advisories on \`next-auth\`. Commit \`fix(deps)\`.
- [ ] 4.1 Run full verification: \`bun test\`, both \`bunx tsc --noEmit\` programs, \`bun run build\`. Commit \`chore\`.
- [ ] 4.2 Archive the consumed audit change.
`;
  const [upgrade, final, archive] = parseTasks(deps);

  test("detects a mid-sentence Verify: and never gates on bun audit", () => {
    const commands = verifyCommands(upgrade!);
    expect(commands.some((c) => c.startsWith("bun audit"))).toBe(false);
    expect(commands).toEqual(["bun test", "bun run lint"]); // nothing extractable -> default gate
  });

  test("full gate adds the full suite to every committing task only", () => {
    expect(verifyCommands(upgrade!, true)).toContain("bun run test:e2e");
    expect(verifyCommands(archive!, true)).toEqual([]);
  });

  test("bare `bunx tsc --noEmit` expands to both programs", () => {
    const commands = verifyCommands(final!);
    expect(commands).toContain("bunx tsc --noEmit -p .nuxt/tsconfig.server.json");
    expect(commands).toContain("bunx tsc --noEmit -p .nuxt/tsconfig.app.json");
    expect(commands).not.toContain("bunx tsc --noEmit");
  });
});

describe("blockedReason", () => {
  test("an empty reason such as 'none' is not a block", () => {
    // Real ending from a DeepSeek 4.1 Flash session through OpenCode
    expect(blockedReason("Task 1.2 is complete and verified.\nBLOCKED: none")).toBeUndefined();
    for (const line of ["BLOCKED: N/A", "BLOCKED: no", "BLOCKED: -", "**BLOCKED:** none.", "BLOCKED: `none`"]) {
      expect(blockedReason(line)).toBeUndefined();
    }
  });

  test("a real reason stops the cascade", () => {
    expect(blockedReason("BLOCKED: smile-ui has no fixed release on the private registry")).toBe(
      "smile-ui has no fixed release on the private registry",
    );
    expect(blockedReason("All done.\nCOMMIT_SUBJECT: pin next")).toBeUndefined();
  });
});

describe("resolveEngine", () => {
  test("resolves claude, opencode, antigravity and alias agy", () => {
    expect(resolveEngine(undefined)).toBe("claude");
    expect(resolveEngine("claude")).toBe("claude");
    expect(resolveEngine("opencode")).toBe("opencode");
    expect(resolveEngine("antigravity")).toBe("antigravity");
    expect(resolveEngine("agy")).toBe("antigravity");
    expect(resolveEngine("AGY")).toBe("antigravity");
  });

  test("throws on invalid engine", () => {
    expect(() => resolveEngine("invalid")).toThrow(/--engine must be/);
  });
});

describe("isKeepAliveEnabled", () => {
  test("returns true by default when options are empty or undefined", () => {
    expect(isKeepAliveEnabled({})).toBe(true);
    expect(isKeepAliveEnabled({ "no-keep-alive": false })).toBe(true);
  });

  test("returns false when --no-keep-alive flag is passed", () => {
    expect(isKeepAliveEnabled({ "no-keep-alive": true })).toBe(false);
  });

  test("returns false when keep-alive is explicitly disabled", () => {
    expect(isKeepAliveEnabled({ "keep-alive": false })).toBe(false);
  });

  test("returns true when keep-alive is explicitly enabled", () => {
    expect(isKeepAliveEnabled({ "keep-alive": true })).toBe(true);
    expect(isKeepAliveEnabled({ "no-keep-alive": false, "keep-alive": true })).toBe(true);
  });
});

describe("cascade CLI keep-alive integration", () => {
  test("activates keep-alive by default", async () => {
    const proc = Bun.spawn(["bun", "run", "cascade.ts", "--dry-run", "--changes", "cross-platform-keep-alive"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(out).toContain("keepAlive=");
    expect(out).not.toContain("keepAlive=disabled");
  });

  test("disables keep-alive when --no-keep-alive flag is passed", async () => {
    const proc = Bun.spawn(["bun", "run", "cascade.ts", "--dry-run", "--changes", "cross-platform-keep-alive", "--no-keep-alive"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(out).toContain("keepAlive=disabled");
  });
});

describe("taskPrompt", () => {
  const dummyTask: Task = {
    id: "1.2",
    done: false,
    text: "Implement taskPrompt injection",
    section: "1. In-Repo Skills Discovery & Context Injection",
    line: 6,
  };

  test("generates base task prompt without skills or directives when repo is empty", () => {
    const tmp = mkdtempSync(join(tmpdir(), "task-prompt-empty-"));
    try {
      const prompt = taskPrompt("in-repo-skills", dummyTask, [], false, tmp);
      expect(prompt).toContain('You are executing the OpenSpec change "in-repo-skills"');
      expect(prompt).toContain('Implement ONLY task 1.2 (section "1. In-Repo Skills Discovery & Context Injection"):');
      expect(prompt).toContain("Implement taskPrompt injection");
      expect(prompt).toContain('COMMIT_SUBJECT: <imperative summary of ALL changes in section "1. In-Repo Skills Discovery & Context Injection", max 60 chars>');
      expect(prompt).not.toContain("<skills>");
      expect(prompt).not.toContain("<project-directives>");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("injects verification commands and section commit instructions appropriately", () => {
    const tmp = mkdtempSync(join(tmpdir(), "task-prompt-verify-"));
    try {
      const prompt = taskPrompt("in-repo-skills", dummyTask, ["bun test", "bun run lint"], true, tmp);
      expect(prompt).toContain("This is a verification task. The harness will run: `bun test`, `bun run lint`.");
      expect(prompt).toContain('COMMIT_MESSAGE: <type>(<scope>): <summary of ALL changes in this section>');
      expect(prompt).not.toContain("COMMIT_SUBJECT:");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("discovers and injects in-repo skills into prompt", () => {
    const tmp = mkdtempSync(join(tmpdir(), "task-prompt-skills-"));
    try {
      const skillDir = join(tmp, ".agents", "skills", "runner-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: runner-skill
description: OpenSpec cascade quality runner.
---
Skill instructions`,
      );

      const prompt = taskPrompt("in-repo-skills", dummyTask, [], false, tmp);
      expect(prompt).toContain("<skills>");
      expect(prompt).toContain("Repository-specific skills are available to assist with this task:");
      expect(prompt).toContain("- runner-skill (.agents/skills/runner-skill/SKILL.md): OpenSpec cascade quality runner.");
      expect(prompt).toContain("Use your file reading tool to inspect any skill file if relevant to the current task.");
      expect(prompt).toContain("</skills>");
      expect(prompt).not.toContain("<project-directives>");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("discovers and injects project directives (AGENTS.md, CLAUDE.md) into prompt", () => {
    const tmp = mkdtempSync(join(tmpdir(), "task-prompt-directives-"));
    try {
      writeFileSync(join(tmp, "AGENTS.md"), "# Project Agent Standards\nFollow zero magic numbers rule.");
      writeFileSync(join(tmp, "CLAUDE.md"), "# Claude Guidelines\nEnsure strict typing.");

      const prompt = taskPrompt("in-repo-skills", dummyTask, [], false, tmp);
      expect(prompt).not.toContain("<skills>");
      expect(prompt).toContain("<project-directives>");
      expect(prompt).toContain("Project-wide directives and constraints:");
      expect(prompt).toContain('<directive file="AGENTS.md">\n# Project Agent Standards\nFollow zero magic numbers rule.\n</directive>');
      expect(prompt).toContain('<directive file="CLAUDE.md">\n# Claude Guidelines\nEnsure strict typing.\n</directive>');
      expect(prompt).toContain("</project-directives>");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("injects both skills and directives in order when both exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "task-prompt-both-"));
    try {
      const skillDir = join(tmp, ".claude", "skills", "helper-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: helper-skill
description: Helpful skill.
---
Helper body`,
      );
      writeFileSync(join(tmp, "AGENTS.md"), "# Directive Content");

      const prompt = taskPrompt("in-repo-skills", dummyTask, [], false, tmp);
      expect(prompt).toContain("<skills>");
      expect(prompt).toContain("- helper-skill (.claude/skills/helper-skill/SKILL.md): Helpful skill.");
      expect(prompt).toContain("</skills>");

      expect(prompt).toContain("<project-directives>");
      expect(prompt).toContain('<directive file="AGENTS.md">\n# Directive Content\n</directive>');
      expect(prompt).toContain("</project-directives>");

      // Verify skills catalog appears before project directives
      const skillsIndex = prompt.indexOf("<skills>");
      const directivesIndex = prompt.indexOf("<project-directives>");
      expect(skillsIndex).toBeGreaterThan(-1);
      expect(directivesIndex).toBeGreaterThan(skillsIndex);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("uses default repo when repoRoot is omitted and discovers repo skills", () => {
    const prompt = taskPrompt("in-repo-skills", dummyTask, [], false);
    expect(prompt).toContain("<skills>");
    expect(prompt).toContain("openspec-cascade-runner");
    expect(prompt).toContain(".agents/skills/openspec-cascade-runner/SKILL.md");
    expect(prompt).toContain("</skills>");
  });
});
