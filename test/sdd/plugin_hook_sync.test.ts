import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_CODE_CONSTANTS } from "../../src/config/constants";
import { getDefaultSpawner } from "../../src/runtime";
import { buildSddHookRules, SDD_HOOK_CONSTANTS, serializeSddHookRules } from "../../src/sdd/hook_rules";
import { isProductionSourceFile } from "../../src/sdd/sdd_gate";

const ROOT = join(import.meta.dir, "..", "..");
const HOOKS = ["sdd_gate.mjs", "sdd_gate.cjs"].map((file) => join(ROOT, "plugins", "cascade", "hooks", file));
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

async function runHook(hook: string, payload: unknown, env: Record<string, string> = {}): Promise<number> {
  const node = getDefaultSpawner().which("node") ?? "node";
  const result = await getDefaultSpawner().run([node, hook], {
    stdin: JSON.stringify(payload),
    env: { PATH: process.env.PATH, ...env },
  });
  return result.exitCode;
}

function repoWith(pendingTask: boolean): string {
  const repo = mkdtempSync(join(tmpdir(), "cascade-hook-"));
  dirs.push(repo);
  const change = join(repo, "openspec", "changes", "c1");
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, "tasks.md"), pendingTask ? "- [ ] 1.1 pending\n" : "- [x] 1.1 done\n");
  return repo;
}

describe("plugin hook synchronization", () => {
  test("committed sdd_rules.json matches the TypeScript constants", () => {
    expect(readFileSync(join(ROOT, SDD_HOOK_CONSTANTS.RULES_RELATIVE_PATH), "utf8")).toBe(serializeSddHookRules());
    expect(buildSddHookRules().blockExitCode).toBe(EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL);
  });

  test("sync script --check passes on the committed rules", async () => {
    const result = await getDefaultSpawner().run([process.execPath, "run", "scripts/sync_plugin.ts", "--check"], { cwd: ROOT });
    expect(result.exitCode).toBe(0);
  });

  const files = ["src/app.ts", "lib/app.rb", "api/handler.php", "core/Main.kt", "test/app.test.ts", "docs/guide.md", "dist/bundle.js", "spec.helper.ts", "README.md", "src/app.spec.ts"];

  for (const hook of HOOKS) {
    test(`${hook.split("/").at(-1)} agrees with the TypeScript gate classification`, async () => {
      const blockedRepo = repoWith(false);
      for (const file of files) {
        const expected = isProductionSourceFile(file) ? EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL : EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
        const exitCode = await runHook(hook, { tool_name: "Write", tool_input: { file_path: file }, cwd: blockedRepo });
        expect({ file, exitCode }).toEqual({ file, exitCode: expected });
      }
    });

    test(`${hook.split("/").at(-1)} allows active changes, ungated tools, bad input and the disable switch`, async () => {
      const payload = { tool_name: "Edit", tool_input: { file_path: "src/app.ts" }, cwd: repoWith(false) };
      expect(await runHook(hook, payload)).toBe(EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL);
      expect(await runHook(hook, payload, { [SDD_HOOK_CONSTANTS.DISABLE_ENV]: SDD_HOOK_CONSTANTS.DISABLE_VALUE })).toBe(0);
      expect(await runHook(hook, { ...payload, cwd: repoWith(true) })).toBe(0);
      expect(await runHook(hook, { ...payload, tool_name: "Read" })).toBe(0);
      expect(await runHook(hook, "not-an-object")).toBe(0);
    });

    test(`${hook.split("/").at(-1)} is opt-in: allows edits in a repo without openspec/`, async () => {
      const plain = mkdtempSync(join(tmpdir(), "cascade-hook-plain-"));
      dirs.push(plain);
      const payload = { tool_name: "Edit", tool_input: { file_path: "src/app.ts" }, cwd: plain };
      expect(await runHook(hook, payload)).toBe(EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS);
    });
  }

  test("installer verifies the hook bundle in dry-run mode", async () => {
    const home = mkdtempSync(join(tmpdir(), "cascade-installer-home-"));
    dirs.push(home);
    const node = getDefaultSpawner().which("node") ?? "node";
    const result = await getDefaultSpawner().run([node, join(ROOT, "bin", "install.mjs"), "--yes", "--dry-run"], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SDD hook bundle verified");
  });
});
