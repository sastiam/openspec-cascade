import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSubcommand, runDoctor, runSubcommand, type CliOutput } from "../../src/cli/commands";
import { GreptileCliClient } from "../../src/integration/greptile/client";
import { createTempGitRepo, runGitCommand, type TempGitRepo } from "../e2e/helpers/temp_repo";

const dirs: string[] = [];
const repos: TempGitRepo[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
  while (repos.length > 0) repos.pop()?.cleanup();
});

function capture(): CliOutput & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, info: (message) => out.push(message), error: (message) => err.push(message) };
}

function catalogItem(key: string, status: string): Record<string, unknown> {
  return {
    task_key: key,
    taskId: key,
    project_item_id: `item-${key}`,
    githubProjectItemId: `item-${key}`,
    title: `${key}: task`,
    workstream: "core",
    stream: "core",
    status,
    priority: "P1",
    size: "S",
    sections_present: [],
    url: `https://example.invalid/${key}`,
    githubUrl: `https://example.invalid/${key}`,
    sections: {},
    body: "",
  };
}

describe("subcommand detection", () => {
  test("recognizes only known subcommands in first position", () => {
    expect(detectSubcommand(["doctor"])).toBe("doctor");
    expect(detectSubcommand(["review", "--base", "main"])).toBe("review");
    expect(detectSubcommand(["--changes", "doctor"])).toBeUndefined();
    expect(detectSubcommand([])).toBeUndefined();
  });
});

describe("doctor", () => {
  test("passes in a git repository with openspec/ and fails outside one", async () => {
    const repo = await createTempGitRepo();
    repos.push(repo);
    mkdirSync(join(repo.repoDir, "openspec"), { recursive: true });
    const output = capture();
    const missingGreptile = new GreptileCliClient({ binary: join(repo.homeDir, "no-greptile") });
    expect(await runSubcommand("doctor", ["--repo", repo.repoDir], { output, greptileClient: missingGreptile })).toBe(0);
    expect(output.out.join("\n")).toContain("ok   git: inside a work tree");
    expect(output.out.join("\n")).toContain("warn greptile: not installed");
    const bare = mkdtempSync(join(tmpdir(), "cascade-doctor-bare-"));
    dirs.push(bare);
    const checks = await runDoctor(bare, { greptileClient: missingGreptile });
    expect(checks.filter((check) => check.status === "fail").map((check) => check.name)).toEqual(["git", "openspec"]);
    expect(await runSubcommand("doctor", ["--repo", bare], { output: capture(), greptileClient: missingGreptile })).toBe(1);
  });
});

describe("drift", () => {
  test("detects drift offline between catalog snapshots and fails closed on bad input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cascade-drift-"));
    dirs.push(dir);
    const local = join(dir, "local.json");
    const remoteSame = join(dir, "remote-same.json");
    const remoteDrift = join(dir, "remote-drift.json");
    writeFileSync(local, JSON.stringify([catalogItem("CORE-001", "Todo")]));
    writeFileSync(remoteSame, JSON.stringify([catalogItem("CORE-001", "Todo")]));
    writeFileSync(remoteDrift, JSON.stringify([catalogItem("CORE-001", "Done")]));
    expect(await runSubcommand("drift", ["--catalog", local, "--remote-json", remoteSame], { output: capture() })).toBe(0);
    const output = capture();
    expect(await runSubcommand("drift", ["--catalog", local, "--remote-json", remoteDrift], { output })).toBe(1);
    expect(output.out.join("\n").length).toBeGreaterThan(0);
    const usage = capture();
    expect(await runSubcommand("drift", ["--remote-json", remoteSame], { output: usage })).toBe(2);
    expect(usage.err[0]).toContain("--catalog is required");
    expect(await runSubcommand("drift", ["--catalog", join(dir, "missing.json"), "--remote-json", remoteSame], { output: capture() })).toBe(2);
  });
});

describe("catalog and review", () => {
  test("catalog --sync fails closed without required flags", async () => {
    const noSync = capture();
    expect(await runSubcommand("catalog", ["--owner", "acme"], { output: noSync })).toBe(2);
    expect(noSync.err[0]).toContain("catalog requires --sync");
    const noProject = capture();
    expect(await runSubcommand("catalog", ["--sync", "--owner", "acme"], { output: noProject })).toBe(2);
    expect(noProject.err[0]).toContain("--project is required");
    expect(await runSubcommand("catalog", ["--sync", "--owner", "acme", "--project", "0"], { output: capture() })).toBe(2);
    expect(await runSubcommand("catalog", ["--sync", "--unknown"], { output: capture() })).toBe(2);
  });

  test("review requires --base and fails closed when Greptile is not installed", async () => {
    const repo = await createTempGitRepo({ branch: "main" });
    repos.push(repo);
    await runGitCommand(repo.repoDir, ["checkout", "-b", "feat/review"]);
    writeFileSync(join(repo.repoDir, "change.ts"), "export const change = 1;\n");
    const usage = capture();
    expect(await runSubcommand("review", ["--repo", repo.repoDir], { output: usage })).toBe(2);
    expect(usage.err[0]).toContain("--base is required");
    const output = capture();
    const missing = new GreptileCliClient({ binary: join(repo.homeDir, "no-greptile") });
    expect(await runSubcommand("review", ["--repo", repo.repoDir, "--base", "main"], { output, greptileClient: missing })).toBe(2);
    expect(output.err[0]).toContain("not_installed");
    expect(await runSubcommand("review", ["--base", "main", "--rounds", "abc"], { output: capture() })).toBe(2);
  });
});
