import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDefaultSpawner } from "../../src/runtime";

const ROOT = join(import.meta.dir, "..", "..");
const TEMPLATE = join(ROOT, "ci", "github-workflows", "ci.yml");
const ACTIVE = join(ROOT, ".github", "workflows", "ci.yml");
const workflow = readFileSync(TEMPLATE, "utf8");

function jobBlock(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("CI workflow", () => {
  test("the Bun job runs every quality gate", () => {
    const bun = jobBlock("bun");
    for (const step of [
      "oven-sh/setup-bun@v2",
      "bun install --frozen-lockfile",
      "bunx tsc --noEmit",
      "bunx eslint .",
      "bun run scripts/forensic_audit.ts",
      "bun run scripts/sync_plugin.ts --check",
      "bunx openspec validate --all --strict",
      "bun test",
    ]) {
      expect(bun).toContain(step);
    }
  });

  test("the Node job runs the parity suite on Node 24", () => {
    const node = jobBlock("node24");
    expect(node).toContain("actions/setup-node@v4");
    expect(node).toMatch(/node-version: 24\b/);
    expect(node).toContain("npm run test:node");
    expect(node).toContain("node --import ./scripts/node_ts_register.mjs cascade.ts --help");
  });

  test("an installed .github/workflows/ci.yml is identical to the canonical template", () => {
    if (existsSync(ACTIVE)) {
      expect(readFileSync(ACTIVE, "utf8")).toBe(workflow);
    }
  });

  test("the workflow uses read-only permissions", () => {
    expect(workflow).toMatch(/permissions:\n {2}contents: read/);
  });
});

describe("repository hygiene", () => {
  test("local cascade state, sandboxes and orchestration notes are ignored", async () => {
    const paths = [".cascade/telemetry/2026-11-15.jsonl", ".redteam_sandbox_1/probe.ts", ".agents/teamwork/agent/progress.md"];
    const result = await getDefaultSpawner().run(["git", "check-ignore", ...paths], { cwd: ROOT });
    expect(result.stdout.trim().split("\n")).toEqual(paths);
  });

  test("orchestration notes are not tracked", async () => {
    const result = await getDefaultSpawner().run(["git", "ls-files", ".agents/teamwork"], { cwd: ROOT });
    expect(result.stdout.trim()).toBe("");
  });
});
