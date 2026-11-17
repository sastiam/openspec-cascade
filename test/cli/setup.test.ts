import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSubcommand, type CliOutput } from "../../src/cli/commands";
import { runSetup, type SetupDeps } from "../../src/cli/setup";
import { EXIT_CODE_CONSTANTS } from "../../src/config/constants";
import { SUGGESTED_RULES_YAML } from "../../src/manifest/rules";

const OK = EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS;
const USAGE = EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

function capture(): CliOutput & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, info: (message) => out.push(message), error: (message) => err.push(message) };
}

interface Env {
  readonly root: string;
  readonly repo: string;
  readonly deps: SetupDeps;
}

function makeEnv(binaries: readonly string[] = []): Env {
  const root = mkdtempSync(join(tmpdir(), "setup-"));
  dirs.push(root);
  const repo = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  const deps: SetupDeps = {
    home,
    xdgConfigHome: join(home, ".config"),
    which: (binary) => (binaries.includes(binary) ? `/bin/${binary}` : null),
    gitCommonDir: () => undefined,
  };
  return { root, repo, deps };
}

function writeGlobal(env: Env, content: unknown): void {
  const dir = join(env.deps.xdgConfigHome, "openspec-cascade");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), typeof content === "string" ? content : JSON.stringify(content));
}

function writeProject(env: Env, entries: unknown[]): void {
  writeFileSync(join(env.repo, ".openspec-cascade.json"), JSON.stringify({ manifest: { entries } }));
}

function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

describe("setup subcommand registration", () => {
  test("detectSubcommand recognises setup", () => {
    expect(detectSubcommand(["setup", "show"])).toBeDefined();
  });
});

describe("Unknown action", () => {
  test("exits 2 with USAGE and changes no file", () => {
    const env = makeEnv();
    writeProject(env, []);
    const before = snapshot(env.root);
    const content = readFileSync(join(env.repo, ".openspec-cascade.json"), "utf8");
    const out = capture();
    expect(runSetup(["install", "--repo", env.repo], out, env.deps)).toBe(USAGE);
    expect(out.err[0]).toStartWith("USAGE: cascade setup:");
    expect(snapshot(env.root)).toEqual(before);
    expect(readFileSync(join(env.repo, ".openspec-cascade.json"), "utf8")).toBe(content);
  });

  test("missing action and unknown flag are usage errors", () => {
    const env = makeEnv();
    expect(runSetup([], capture(), env.deps)).toBe(USAGE);
    const out = capture();
    expect(runSetup(["show", "--bogus"], out, env.deps)).toBe(USAGE);
    expect(out.err[0]).toStartWith("USAGE:");
  });
});

describe("Show merged JSON", () => {
  test("prints entries with layer sorted by name then type", () => {
    const env = makeEnv();
    writeGlobal(env, {
      entries: [
        { name: "gh", type: "cli", whenToUse: "For CI runs" },
        { name: "engram", type: "mcp", whenToUse: "Memory" },
      ],
    });
    writeProject(env, [
      { name: "engram", type: "cli", whenToUse: "Memory CLI", required: true, check: "engram --version", profile: "ro", hosts: ["opencode"] },
      { name: "aws", type: "cli", whenToUse: "Cloud" },
    ]);
    const out = capture();
    expect(runSetup(["show", "--json", "--repo", env.repo], out, env.deps)).toBe(OK);
    const parsed = JSON.parse(out.out.join("\n")) as { entries: Record<string, unknown>[] };
    expect(Object.keys(parsed)).toEqual(["entries"]);
    expect(parsed.entries.map((entry) => `${String(entry.name)}:${String(entry.type)}:${String(entry.layer)}`)).toEqual([
      "aws:cli:project",
      "engram:cli:project",
      "engram:mcp:global",
      "gh:cli:global",
    ]);
    expect(parsed.entries[0]).toEqual({ name: "aws", type: "cli", whenToUse: "Cloud", required: false, layer: "project" });
    expect(parsed.entries[1]).toMatchObject({ required: true, check: "engram --version", profile: "ro", hosts: ["opencode"] });
  });
});

describe("Show as text", () => {
  test("prints one line per entry", () => {
    const env = makeEnv();
    writeProject(env, [{ name: "stitch", type: "mcp", whenToUse: "Before UI tasks, fetch the screen design" }]);
    const out = capture();
    expect(runSetup(["show", "--repo", env.repo], out, env.deps)).toBe(OK);
    expect(out.out).toContain("project mcp stitch: Before UI tasks, fetch the screen design");
  });

  test("prints nothing without entries", () => {
    const env = makeEnv();
    const out = capture();
    expect(runSetup(["show", "--repo", env.repo], out, env.deps)).toBe(OK);
    expect(out.out).toEqual([]);
  });
});

describe("Invalid manifest on show", () => {
  test("exits 2 with a STOPPED line naming the global layer", () => {
    const env = makeEnv();
    writeGlobal(env, { entries: [{ name: "x", type: "service", whenToUse: "w" }] });
    const out = capture();
    expect(runSetup(["show", "--repo", env.repo], out, env.deps)).toBe(USAGE);
    expect(out.err[0]).toStartWith("STOPPED: setup:");
    expect(out.err[0]).toContain("global layer");
  });
});

describe("Invalid manifest on discover", () => {
  test("exits 2 and names the global layer", () => {
    const env = makeEnv();
    writeGlobal(env, { entries: [{ name: "x", type: "service", whenToUse: "w" }] });
    const out = capture();
    expect(runSetup(["discover", "--json", "--repo", env.repo], out, env.deps)).toBe(USAGE);
    expect(out.err[0]).toContain("global layer");
  });
});

describe("discover", () => {
  test("--json parses with candidates and skipped", () => {
    const env = makeEnv(["gh"]);
    writeFileSync(join(env.repo, ".mcp.json"), "{not json");
    writeGlobal(env, { entries: [{ name: "gh", type: "cli", whenToUse: "CI" }] });
    const out = capture();
    expect(runSetup(["discover", "--json", "--repo", env.repo], out, env.deps)).toBe(OK);
    const parsed = JSON.parse(out.out.join("\n")) as { candidates: Record<string, unknown>[]; skipped: Record<string, unknown>[] };
    expect(Object.keys(parsed).sort()).toEqual(["candidates", "skipped"]);
    expect(parsed.candidates).toEqual([{ name: "gh", type: "cli", sources: ["PATH"], hosts: [], inManifest: "global" }]);
    expect(parsed.skipped).toEqual([{ source: "<repo>/.mcp.json", reason: "invalid JSON" }]);
  });

  test("text output succeeds", () => {
    const env = makeEnv(["bun"]);
    const out = capture();
    expect(runSetup(["discover", "--repo", env.repo], out, env.deps)).toBe(OK);
    expect(out.out.join("\n")).toContain("bun");
  });
});

describe("Print rules", () => {
  test("prints the template and changes no file", () => {
    const env = makeEnv();
    mkdirSync(join(env.repo, "openspec"));
    writeFileSync(join(env.repo, "openspec", "config.yaml"), "schema: spec-driven\n");
    const before = snapshot(env.root);
    const out = capture();
    expect(runSetup(["rules", "--repo", env.repo], out, env.deps)).toBe(OK);
    expect(`${out.out.join("\n")}\n`).toBe(SUGGESTED_RULES_YAML);
    expect(out.out.join("\n")).toContain("manual.md");
    expect(snapshot(env.root)).toEqual(before);
    expect(readFileSync(join(env.repo, "openspec", "config.yaml"), "utf8")).toBe("schema: spec-driven\n");
  });
});

const REFUSED = EXIT_CODE_CONSTANTS.EXIT_CODE_ERROR;

function projectFile(env: Env): string {
  return join(env.repo, ".openspec-cascade.json");
}

function readProject(env: Env): Record<string, unknown> {
  return JSON.parse(readFileSync(projectFile(env), "utf8")) as Record<string, unknown>;
}

function globalFile(env: Env): string {
  return join(env.deps.xdgConfigHome, "openspec-cascade", "manifest.json");
}

function writeConfig(env: Env, text: string): string {
  mkdirSync(join(env.repo, "openspec"), { recursive: true });
  const file = join(env.repo, "openspec", "config.yaml");
  writeFileSync(file, text);
  return file;
}

describe("Add to the project layer", () => {
  test("adds the entry, keeps other keys and prints added", () => {
    const env = makeEnv();
    writeFileSync(projectFile(env), JSON.stringify({ maxIterations: 3, manifest: { entries: [] } }));
    const out = capture();
    const argv = ["add", "--scope", "project", "--name", "stitch", "--type", "mcp", "--when", "Before UI tasks, fetch the screen design", "--repo", env.repo];
    expect(runSetup(argv, out, env.deps)).toBe(OK);
    expect(out.out).toEqual(["added stitch (mcp) to the project layer"]);
    const file = readProject(env);
    expect(file.maxIterations).toBe(3);
    expect(file.manifest).toEqual({ entries: [{ name: "stitch", type: "mcp", whenToUse: "Before UI tasks, fetch the screen design" }] });
    expect(readFileSync(projectFile(env), "utf8").endsWith("}\n")).toBe(true);
  });

  test("creates the project file when missing", () => {
    const env = makeEnv();
    expect(runSetup(["add", "--scope", "project", "--name", "gh", "--type", "cli", "--when", "CI", "--repo", env.repo], capture(), env.deps)).toBe(OK);
    expect(Object.keys(readProject(env))).toEqual(["manifest"]);
  });

  test("repeats --host and stores optional flags", () => {
    const env = makeEnv();
    const argv = [
      "add", "--scope", "project", "--name", "gh", "--type", "cli", "--when", "CI", "--required",
      "--check", "gh --version", "--profile", "ro", "--host", "claude-code", "--host", "opencode", "--repo", env.repo,
    ];
    expect(runSetup(argv, capture(), env.deps)).toBe(OK);
    expect((readProject(env).manifest as { entries: unknown[] }).entries[0]).toEqual({
      name: "gh", type: "cli", whenToUse: "CI", required: true, check: "gh --version", profile: "ro", hosts: ["claude-code", "opencode"],
    });
  });
});

describe("Add replaces in place", () => {
  test("keeps order and prints updated", () => {
    const env = makeEnv();
    writeProject(env, [
      { name: "aws", type: "cli", whenToUse: "a" },
      { name: "stitch", type: "mcp", whenToUse: "old" },
      { name: "gh", type: "cli", whenToUse: "g" },
    ]);
    const out = capture();
    expect(runSetup(["add", "--scope", "project", "--name", "stitch", "--type", "mcp", "--when", "new", "--repo", env.repo], out, env.deps)).toBe(OK);
    expect(out.out).toEqual(["updated stitch (mcp) in the project layer"]);
    const entries = (readProject(env).manifest as { entries: { name: string; whenToUse: string }[] }).entries;
    expect(entries.map((entry) => entry.name)).toEqual(["aws", "stitch", "gh"]);
    expect(entries[1]?.whenToUse).toBe("new");
  });

  test("same name with another type is appended", () => {
    const env = makeEnv();
    writeProject(env, [{ name: "gh", type: "cli", whenToUse: "g" }]);
    runSetup(["add", "--scope", "project", "--name", "gh", "--type", "mcp", "--when", "m", "--repo", env.repo], capture(), env.deps);
    const entries = (readProject(env).manifest as { entries: { type: string }[] }).entries;
    expect(entries.map((entry) => entry.type)).toEqual(["cli", "mcp"]);
  });
});

describe("Add without when", () => {
  test("exits 2 and changes no file", () => {
    const env = makeEnv();
    const before = snapshot(env.root);
    const out = capture();
    expect(runSetup(["add", "--scope", "global", "--name", "gh", "--type", "cli", "--repo", env.repo], out, env.deps)).toBe(USAGE);
    expect(out.err[0]).toStartWith("USAGE:");
    expect(snapshot(env.root)).toEqual(before);
  });
});

describe("Add creates the global file", () => {
  test("creates the folder and manifest.json", () => {
    const env = makeEnv();
    const out = capture();
    expect(runSetup(["add", "--scope", "global", "--name", "gh", "--type", "cli", "--when", "For CI runs", "--repo", env.repo], out, env.deps)).toBe(OK);
    expect(out.out).toEqual(["added gh (cli) to the global layer"]);
    expect(JSON.parse(readFileSync(globalFile(env), "utf8"))).toEqual({ entries: [{ name: "gh", type: "cli", whenToUse: "For CI runs" }] });
  });
});

describe("Invalid project file", () => {
  test("exits 2 and leaves the file unchanged", () => {
    const env = makeEnv();
    writeFileSync(projectFile(env), "{not json");
    const out = capture();
    expect(runSetup(["add", "--scope", "project", "--name", "gh", "--type", "cli", "--when", "w", "--repo", env.repo], out, env.deps)).toBe(USAGE);
    expect(out.err[0]).toStartWith("STOPPED: setup:");
    expect(readFileSync(projectFile(env), "utf8")).toBe("{not json");
  });

  test("invalid manifest leaves the global file unchanged", () => {
    const env = makeEnv();
    writeGlobal(env, { entries: [{ name: "x", type: "service", whenToUse: "w" }] });
    const before = readFileSync(globalFile(env), "utf8");
    expect(runSetup(["add", "--scope", "global", "--name", "gh", "--type", "cli", "--when", "w", "--repo", env.repo], capture(), env.deps)).toBe(USAGE);
    expect(readFileSync(globalFile(env), "utf8")).toBe(before);
  });
});

describe("remove", () => {
  test("removes an entry and prints removed", () => {
    const env = makeEnv();
    writeProject(env, [{ name: "aws", type: "cli", whenToUse: "a" }, { name: "gh", type: "cli", whenToUse: "g" }]);
    const out = capture();
    expect(runSetup(["remove", "--scope", "project", "--name", "aws", "--type", "cli", "--repo", env.repo], out, env.deps)).toBe(OK);
    expect(out.out).toEqual(["removed aws (cli) from the project layer"]);
    expect((readProject(env).manifest as { entries: { name: string }[] }).entries.map((entry) => entry.name)).toEqual(["gh"]);
  });

  test("missing entry exits 2 and changes nothing", () => {
    const env = makeEnv();
    writeProject(env, [{ name: "aws", type: "cli", whenToUse: "a" }]);
    const before = readFileSync(projectFile(env), "utf8");
    expect(runSetup(["remove", "--scope", "project", "--name", "aws", "--type", "mcp", "--repo", env.repo], capture(), env.deps)).toBe(USAGE);
    expect(readFileSync(projectFile(env), "utf8")).toBe(before);
  });
});

describe("rules --write", () => {
  test("Config without rules appends the block", () => {
    const env = makeEnv();
    const original = "# comment\nschema: spec-driven\n";
    const file = writeConfig(env, original);
    const out = capture();
    expect(runSetup(["rules", "--write", "--repo", env.repo], out, env.deps)).toBe(OK);
    expect(out.out).toEqual(["wrote rules to openspec/config.yaml"]);
    expect(readFileSync(file, "utf8")).toBe(`${original}${SUGGESTED_RULES_YAML}`);
  });

  test("Commented-out rules key still appends", () => {
    const env = makeEnv();
    const file = writeConfig(env, "# rules:\n");
    expect(runSetup(["rules", "--write", "--repo", env.repo], capture(), env.deps)).toBe(OK);
    expect(readFileSync(file, "utf8")).toBe(`# rules:\n${SUGGESTED_RULES_YAML}`);
  });

  test("Config with rules exits 1 unchanged", () => {
    const env = makeEnv();
    const text = "schema: x\nrules:\n  tasks: []\n";
    const file = writeConfig(env, text);
    const out = capture();
    expect(runSetup(["rules", "--write", "--repo", env.repo], out, env.deps)).toBe(REFUSED);
    expect(out.err).toEqual(["REFUSED: openspec/config.yaml already has a rules key"]);
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  test("Quoted rules key exits 1 unchanged", () => {
    const env = makeEnv();
    const text = '"rules":\n  tasks: []\n';
    const file = writeConfig(env, text);
    expect(runSetup(["rules", "--write", "--repo", env.repo], capture(), env.deps)).toBe(REFUSED);
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  test("Missing config exits 2 with an openspec init hint", () => {
    const env = makeEnv();
    const out = capture();
    expect(runSetup(["rules", "--write", "--repo", env.repo], out, env.deps)).toBe(USAGE);
    expect(out.err[0]).toStartWith("STOPPED: setup:");
    expect(out.err[0]).toContain("openspec init");
  });
});
