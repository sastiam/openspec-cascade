import { describe, expect, test } from "bun:test";
import {
  blockedReason,
  commitsPerSection,
  commitTypeOf,
  isKeepAliveEnabled,
  isLastOfSection,
  parseTasks,
  resolveEngine,
  verifyCommands,
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
