import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSubcommand, type CliOutput } from "../../src/cli/commands";
import { runSpecGate } from "../../src/cli/spec_gate";
import { EXIT_CODE_CONSTANTS } from "../../src/config/constants";

const OK = EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
const NOT_OK = EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;
const USAGE = EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;
const FENCES_PER_BLOCK = 2; // opening and closing `---` of one front-matter block

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

function capture(): CliOutput & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, info: (message) => out.push(message), error: (message) => err.push(message) };
}

function makeRepo(changes: string[]): string {
  const repo = mkdtempSync(join(tmpdir(), "spec-gate-"));
  dirs.push(repo);
  for (const change of changes) {
    const dir = join(repo, "openspec", "changes", change);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "design.md"), "# Design\n");
    writeFileSync(join(dir, "tasks.md"), "- [ ] 1. do it\n");
    writeFileSync(join(dir, "review.md"), "# Report\n");
  }
  return repo;
}

function makeArchive(repo: string, entries: string[]): void {
  for (const entry of entries) mkdirSync(join(repo, "openspec", "changes", "archive", entry), { recursive: true });
}

function stamp(repo: string, change: string, status: string, stage = "review"): number {
  return runSpecGate(["stamp", "--repo", repo, "--stage", stage, "--change", change, "--status", status], capture());
}

function check(repo: string, changes: string, output = capture(), stage = "review"): number {
  return runSpecGate(["check", "--repo", repo, "--stage", stage, "--changes", changes], output);
}

describe("spec-gate", () => {
  test("is registered as a subcommand", () => {
    expect(detectSubcommand(["spec-gate", "check"])).toBe("spec-gate");
  });

  test("check exits 0 when every change is resolved and fresh", () => {
    const repo = makeRepo(["a", "b"]);
    expect(stamp(repo, "a", "resolved")).toBe(OK);
    expect(stamp(repo, "b", "resolved")).toBe(OK);
    expect(check(repo, "a,b")).toBe(OK);
  });

  test("check exits 1 and reports every failing change", () => {
    const repo = makeRepo(["a", "b", "c"]);
    stamp(repo, "c", "resolved");
    const output = capture();
    expect(check(repo, "a,b,c", output)).toBe(NOT_OK);
    const report = output.err.join("\n");
    expect(report).toContain("a");
    expect(report).toContain("b");
    expect(report).toContain("malformed");
  });

  test("check reports an archived change with its archive directory", () => {
    const repo = makeRepo([]);
    makeArchive(repo, ["2026-11-16-tasks-lint"]);
    const output = capture();
    expect(check(repo, "tasks-lint", output)).toBe(NOT_OK);
    expect(output.err).toEqual(["tasks-lint: review archived (openspec/changes/archive/2026-11-16-tasks-lint)"]);
  });

  test("check reports the most recent archive of a change archived twice", () => {
    const repo = makeRepo([]);
    makeArchive(repo, ["2026-01-05-thing", "2026-03-09-thing", "2026-02-01-thing"]);
    const output = capture();
    expect(check(repo, "thing", output)).toBe(NOT_OK);
    expect(output.err).toEqual(["thing: review archived (openspec/changes/archive/2026-03-09-thing)"]);
  });

  test("check reports no change folder when the change and the archive directory do not exist", () => {
    const repo = makeRepo([]);
    const output = capture();
    expect(check(repo, "foo", output)).toBe(NOT_OK);
    expect(output.err).toEqual(["foo: review no change folder (openspec/changes/foo)"]);
  });

  test("check does not treat an archive directory with a shared suffix as archived", () => {
    const repo = makeRepo([]);
    makeArchive(repo, ["2026-01-01-big-thing"]);
    const output = capture();
    expect(check(repo, "thing", output)).toBe(NOT_OK);
    expect(output.err).toEqual(["thing: review no change folder (openspec/changes/thing)"]);
  });

  test("check does not treat a dot in the change name as a wildcard", () => {
    const repo = makeRepo([]);
    makeArchive(repo, ["2026-01-01-a-b"]);
    const output = capture();
    expect(check(repo, "a.b", output)).toBe(NOT_OK);
    expect(output.err).toEqual(["a.b: review no change folder (openspec/changes/a.b)"]);
  });

  test("check keeps reporting a missing report for an existing change, even with an archived copy", () => {
    const repo = makeRepo(["a"]);
    makeArchive(repo, ["2026-01-01-a"]);
    const output = capture();
    expect(check(repo, "a", output, "drift")).toBe(NOT_OK);
    expect(output.err).toEqual(["a: drift missing (drift.md)"]);
  });

  test("check reports only the archived change in a mixed list", () => {
    const repo = makeRepo(["a"]);
    makeArchive(repo, ["2026-11-16-old"]);
    expect(stamp(repo, "a", "resolved")).toBe(OK);
    const output = capture();
    expect(check(repo, "old,a", output)).toBe(NOT_OK);
    expect(output.err).toEqual(["old: review archived (openspec/changes/archive/2026-11-16-old)"]);
  });

  test("a repeated --changes flag checks every value, not only the last", () => {
    const repo = makeRepo(["unreviewed", "ok"]);
    stamp(repo, "ok", "resolved");
    const argv = ["check", "--repo", repo, "--stage", "review", "--changes", "unreviewed", "--changes", "ok"];
    const output = capture();
    expect(runSpecGate(argv, output)).toBe(NOT_OK);
    expect(output.err.join("\n")).toContain("unreviewed: review malformed");
  });

  test("check rejects a change name with path traversal", () => {
    const repo = makeRepo(["a"]);
    expect(check(repo, "../a")).toBe(USAGE);
    expect(check(repo, "a/../../x")).toBe(USAGE);
  });

  test("check rejects an unknown stage", () => {
    const repo = makeRepo(["a"]);
    expect(check(repo, "a", capture(), "launch")).toBe(USAGE);
  });

  test("stamp then check round-trips and goes stale after a design edit", () => {
    const repo = makeRepo(["a"]);
    expect(stamp(repo, "a", "resolved")).toBe(OK);
    expect(check(repo, "a")).toBe(OK);
    writeFileSync(join(repo, "openspec", "changes", "a", "design.md"), "# Design\nEdited later.\n");
    const output = capture();
    expect(check(repo, "a", output)).toBe(NOT_OK);
    expect(output.err.join("\n")).toContain("stale");
  });

  test("an open stamp makes check fail", () => {
    const repo = makeRepo(["a"]);
    stamp(repo, "a", "open");
    const output = capture();
    expect(check(repo, "a", output)).toBe(NOT_OK);
    expect(output.err.join("\n")).toContain("open");
  });

  test("stamp exits 2 when the report does not exist", () => {
    const repo = makeRepo(["a"]);
    expect(stamp(repo, "a", "resolved", "drift")).toBe(USAGE);
  });

  test("stamp replaces an existing block instead of stacking a second one", () => {
    const repo = makeRepo(["a"]);
    stamp(repo, "a", "open");
    stamp(repo, "a", "resolved");
    const content = readFileSync(join(repo, "openspec", "changes", "a", "review.md"), "utf8");
    expect(content.match(/^---$/gm)?.length).toBe(FENCES_PER_BLOCK);
    expect(content).toContain("status: resolved");
    expect(content).not.toContain("status: open");
    expect(content).toContain("# Report");
  });
});
