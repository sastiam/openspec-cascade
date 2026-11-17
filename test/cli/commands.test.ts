import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSubcommand, runDoctor, runSubcommand, type CliOutput } from "../../src/cli/commands";
import { GreptileCliClient, type IGreptileClient } from "../../src/integration/greptile/client";
import { SpawnError, type ISpawner, type SpawnOptions, type SpawnResult } from "../../src/runtime/types";
import type { ManifestPaths } from "../../src/manifest/types";
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

const fakeGreptile: IGreptileClient = {
  checkStatus: async () => ({ installed: false, authenticated: false, detail: "fake" }),
} as unknown as IGreptileClient;

function manifestHome(entries?: unknown, projectManifest?: unknown): { paths: ManifestPaths; repo: string } {
  const root = mkdtempSync(join(tmpdir(), "cascade-doctor-manifest-"));
  dirs.push(root);
  const paths = { home: root, xdgConfigHome: join(root, "config") };
  if (entries !== undefined) {
    mkdirSync(join(paths.xdgConfigHome, "openspec-cascade"), { recursive: true });
    writeFileSync(join(paths.xdgConfigHome, "openspec-cascade", "manifest.json"), typeof entries === "string" ? entries : JSON.stringify({ entries }));
  }
  const repo = join(root, "repo");
  mkdirSync(join(repo, "openspec"), { recursive: true });
  if (projectManifest !== undefined) writeFileSync(join(repo, ".openspec-cascade.json"), JSON.stringify({ manifest: { entries: projectManifest } }));
  return { paths, repo };
}

interface Recorded {
  argv: readonly string[];
  options?: SpawnOptions;
}

function fakeSpawner(exitCodes: Record<string, number> = {}): { spawner: ISpawner; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const spawner = {
    runtime: "bun",
    detectRuntime: () => "bun",
    which: () => null,
    run: async (argv: readonly string[], options?: SpawnOptions): Promise<SpawnResult> => {
      calls.push({ argv, options });
      const program = argv[0] ?? "";
      if (program === "missing-tool") throw new SpawnError(argv, "ENOENT", "Missing program");
      const timedOut = program === "slow-tool";
      return { exitCode: exitCodes[program] ?? 0, stdout: "", stderr: "", timedOut, aborted: false };
    },
  } as unknown as ISpawner;
  return { spawner, calls };
}

function emptyPaths(): ManifestPaths {
  return manifestHome().paths;
}

const checkCalls = (calls: Recorded[], program: string): Recorded[] => calls.filter((call) => call.argv[0] === program);
const entry = (over: Record<string, unknown>): Record<string, unknown> => ({ name: "tool", type: "cli", whenToUse: "when needed", ...over });
const byName = (checks: { name: string; status: string; detail: string }[], name: string) => checks.find((check) => check.name === name);

describe("doctor manifest", () => {
  test("reports entries per layer and runs global checks", async () => {
    const { paths, repo } = manifestHome([entry({ name: "gh", check: "gh auth status", required: true }), entry({ name: "note" })]);
    const { spawner, calls } = fakeSpawner();
    const checks = await runDoctor(repo, { spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    expect(byName(checks, "manifest:global:gh (cli)")).toMatchObject({ status: "ok", detail: "check passed" });
    expect(byName(checks, "manifest:global:note (cli)")).toMatchObject({ status: "ok", detail: "declared, no check" });
    expect(checkCalls(calls, "gh")[0]?.argv).toEqual(["gh", "auth", "status"]);
  });

  test("required entry fails and exits 1; optional entry warns", async () => {
    const { paths, repo } = manifestHome([entry({ name: "req", check: "req-tool x", required: true }), entry({ name: "opt", check: "opt-tool" })]);
    const { spawner } = fakeSpawner({ "req-tool": 3, "opt-tool": 2 });
    const checks = await runDoctor(repo, { spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    expect(byName(checks, "manifest:global:req (cli)")).toMatchObject({ status: "fail", detail: "exit 3" });
    expect(byName(checks, "manifest:global:opt (cli)")).toMatchObject({ status: "warn", detail: "exit 2" });
    expect(await runSubcommand("doctor", ["--repo", repo], { output: capture(), spawner, greptileClient: fakeGreptile, manifestPaths: paths })).toBe(1);
  });

  test("Optional entry fails: alone it does not make doctor exit 1", async () => {
    const { paths, repo } = manifestHome([entry({ name: "opt", check: "opt-tool" })]);
    const { spawner } = fakeSpawner({ "opt-tool": 1 });
    const output = capture();
    await runSubcommand("doctor", ["--repo", repo], { output, spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    expect(output.out.join("\n")).toContain("warn manifest:global:opt (cli): exit 1");
    expect(output.out.some((line) => line.startsWith("fail") && line.includes("manifest"))).toBe(false);
  });

  test("broken manifest reports one fail check and keeps the others", async () => {
    const { paths, repo } = manifestHome("{ not json");
    const { spawner } = fakeSpawner();
    const checks = await runDoctor(repo, { spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    expect(checks.filter((check) => check.name.startsWith("manifest"))).toEqual([
      { name: "manifest", status: "fail", detail: "global layer: invalid JSON" },
    ]);
    expect(byName(checks, "git")).toBeDefined();
    expect(byName(checks, "telemetry")).toBeDefined();
  });

  test("Project check without the flag is not started; with the flag it is", async () => {
    const { paths, repo } = manifestHome(undefined, [entry({ name: "proj", check: "proj-tool --v", required: true })]);
    const first = fakeSpawner();
    const without = await runDoctor(repo, { spawner: first.spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    expect(byName(without, "manifest:project:proj (cli)")).toMatchObject({ status: "ok", detail: "check not run; use --run-project-checks" });
    expect(checkCalls(first.calls, "proj-tool")).toHaveLength(0);
    const second = fakeSpawner();
    const output = capture();
    await runSubcommand("doctor", ["--repo", repo, "--run-project-checks"], { output, spawner: second.spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    expect(checkCalls(second.calls, "proj-tool")).toHaveLength(1);
    expect(output.out.join("\n")).toContain("manifest:project:proj (cli): check passed");
    const third = fakeSpawner();
    const flagged = await runDoctor(repo, { spawner: third.spawner, greptileClient: fakeGreptile, manifestPaths: paths }, { runProjectChecks: true });
    expect(byName(flagged, "manifest:project:proj (cli)")?.detail).toBe("check passed");
  });

  test("Check times out and Missing program", async () => {
    const { paths, repo } = manifestHome([
      entry({ name: "slow", check: "slow-tool", required: true }),
      entry({ name: "gone", check: "missing-tool" }),
    ]);
    const { spawner } = fakeSpawner();
    const checks = await runDoctor(repo, { spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    expect(byName(checks, "manifest:global:slow (cli)")).toMatchObject({ status: "fail", detail: "timed out" });
    expect(byName(checks, "manifest:global:gone (cli)")).toMatchObject({ status: "warn", detail: "not found" });
  });

  test("Check environment: argv, no stdin, env, timeout and cwd", async () => {
    const { paths, repo } = manifestHome([entry({ name: "aws", check: "  aws   sts get-caller-identity ", required: true })]);
    const { spawner, calls } = fakeSpawner();
    await runDoctor(repo, { spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    const [call] = checkCalls(calls, "aws");
    expect(call?.argv).toEqual(["aws", "sts", "get-caller-identity"]);
    expect(call?.options?.stdin).toBeUndefined();
    expect(call?.options?.cwd).toBe(repo);
    expect(call?.options?.timeoutMs).toBe(15000);
    expect(call?.options?.env?.AWS_PAGER).toBe("");
    expect(call?.options?.env?.PATH).toBe(process.env.PATH);
  });

  test("Injected paths: only the given folder is read", async () => {
    const { paths, repo } = manifestHome([entry({ name: "only-here" })]);
    const other = manifestHome([entry({ name: "elsewhere" })]);
    const { spawner } = fakeSpawner();
    const checks = await runDoctor(repo, { spawner, greptileClient: fakeGreptile, manifestPaths: paths });
    expect(byName(checks, "manifest:global:only-here (cli)")).toBeDefined();
    expect(checks.some((check) => check.name.includes("elsewhere"))).toBe(false);
    expect(other.paths.xdgConfigHome).not.toBe(paths.xdgConfigHome);
  });
});

describe("doctor", () => {
  test("passes in a git repository with openspec/ and fails outside one", async () => {
    const repo = await createTempGitRepo();
    repos.push(repo);
    mkdirSync(join(repo.repoDir, "openspec"), { recursive: true });
    const output = capture();
    const missingGreptile = new GreptileCliClient({ binary: join(repo.homeDir, "no-greptile") });
    expect(await runSubcommand("doctor", ["--repo", repo.repoDir], { output, greptileClient: missingGreptile, manifestPaths: emptyPaths() })).toBe(0);
    expect(output.out.join("\n")).toContain("ok   git: inside a work tree");
    expect(output.out.join("\n")).toContain("warn greptile: not installed");
    const bare = mkdtempSync(join(tmpdir(), "cascade-doctor-bare-"));
    dirs.push(bare);
    const checks = await runDoctor(bare, { greptileClient: missingGreptile, manifestPaths: emptyPaths() });
    expect(checks.filter((check) => check.status === "fail").map((check) => check.name)).toEqual(["git", "openspec"]);
    expect(await runSubcommand("doctor", ["--repo", bare], { output: capture(), greptileClient: missingGreptile, manifestPaths: emptyPaths() })).toBe(1);
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
