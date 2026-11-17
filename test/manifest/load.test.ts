import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANIFEST_CONSTANTS } from "../../src/config/constants";
import { loadGlobalLayer, loadManifest, loadProjectLayer, ManifestError, resolveManifestPaths } from "../../src/manifest/load";
import type { ManifestPaths } from "../../src/manifest/types";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

interface Fixture {
  paths: ManifestPaths;
  repo: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "manifest-"));
  dirs.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  return { paths: { home: join(root, "home"), xdgConfigHome: join(root, "cfg") }, repo };
}

function writeGlobal(fx: Fixture, content: unknown): void {
  const dir = join(fx.paths.xdgConfigHome, MANIFEST_CONSTANTS.GLOBAL_DIR);
  mkdirSync(dir, { recursive: true });
  const text = typeof content === "string" ? content : JSON.stringify(content);
  writeFileSync(join(dir, MANIFEST_CONSTANTS.GLOBAL_FILE), text);
}

function writeProject(fx: Fixture, entries: unknown[], extra: Record<string, unknown> = {}): void {
  writeFileSync(join(fx.repo, ".openspec-cascade.json"), JSON.stringify({ ...extra, manifest: { entries } }));
}

function entry(name: string, type = "mcp", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, type, whenToUse: `Use ${name}`, ...extra };
}

function failure(run: () => unknown): ManifestError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ManifestError);
    return error as ManifestError;
  }
  throw new Error("expected ManifestError");
}

describe("Manifest locations", () => {
  test("XDG config home", () => {
    const fx = fixture();
    const paths = resolveManifestPaths({ XDG_CONFIG_HOME: fx.paths.xdgConfigHome }, "/unused/home");
    expect(paths.xdgConfigHome).toBe(fx.paths.xdgConfigHome);
    writeGlobal(fx, { entries: [entry("watson")] });
    expect(loadGlobalLayer(paths).map((e) => e.name)).toEqual(["watson"]);
  });

  test("Empty XDG config home", () => {
    const paths = resolveManifestPaths({ XDG_CONFIG_HOME: "" }, "/tmp/home");
    expect(paths).toEqual({ home: "/tmp/home", xdgConfigHome: join("/tmp/home", ".config") });
  });

  test("Unset XDG config home", () => {
    expect(resolveManifestPaths({}, "/tmp/home").xdgConfigHome).toBe(join("/tmp/home", ".config"));
  });

  test("project layer is read from the manifest key", () => {
    const fx = fixture();
    writeProject(fx, [entry("stitch")], { other: 1 });
    expect(loadProjectLayer(fx.repo).map((e) => e.name)).toEqual(["stitch"]);
  });
});

describe("Manifest merge", () => {
  test("Project overrides global", () => {
    const fx = fixture();
    writeGlobal(fx, { entries: [{ ...entry("watson"), whenToUse: "global one" }] });
    writeProject(fx, [{ ...entry("watson"), whenToUse: "project one" }]);
    const merged = loadManifest(fx.paths, fx.repo);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.whenToUse).toBe("project one");
    expect(merged[0]?.layer).toBe("project");
  });

  test("Same name, different type", () => {
    const fx = fixture();
    writeGlobal(fx, { entries: [entry("engram", "cli")] });
    writeProject(fx, [entry("engram", "mcp")]);
    const merged = loadManifest(fx.paths, fx.repo);
    expect(merged.map((e) => `${e.layer}:${e.type}`)).toEqual(["global:cli", "project:mcp"]);
  });

  test("Missing layers", () => {
    const fx = fixture();
    expect(loadManifest(fx.paths, fx.repo)).toEqual([]);
  });

  test("project config without manifest key is an empty layer", () => {
    const fx = fixture();
    writeFileSync(join(fx.repo, ".openspec-cascade.json"), JSON.stringify({ other: 1 }));
    expect(loadManifest(fx.paths, fx.repo)).toEqual([]);
  });

  test("sorted by name then type, with the exact keys", () => {
    const fx = fixture();
    writeGlobal(fx, { entries: [entry("b", "mcp"), entry("a", "skill"), entry("a", "cli", { required: true })] });
    const merged = loadManifest(fx.paths, fx.repo);
    expect(merged.map((e) => `${e.name}:${e.type}`)).toEqual(["a:cli", "a:skill", "b:mcp"]);
    expect(Object.keys(merged[1] ?? {}).sort()).toEqual(["layer", "name", "required", "type", "whenToUse"]);
    expect(merged[0]?.required).toBe(true);
    expect(merged[1]?.required).toBe(false);
  });
});

describe("Manifest entry fields", () => {
  test("Unknown type", () => {
    const fx = fixture();
    writeGlobal(fx, { entries: [entry("watson", "service")] });
    const error = failure(() => loadManifest(fx.paths, fx.repo));
    expect(error.message.startsWith("global layer:")).toBe(true);
    expect(error.message).toContain("watson");
  });

  test("whenToUse too long", () => {
    const fx = fixture();
    writeProject(fx, [{ ...entry("stitch"), whenToUse: "x".repeat(MANIFEST_CONSTANTS.WHEN_TO_USE_MAX_LENGTH + 1) }]);
    const error = failure(() => loadManifest(fx.paths, fx.repo));
    expect(error.message.startsWith("project layer:")).toBe(true);
    expect(error.message).toContain("stitch");
  });

  test("whenToUse at the limit is accepted", () => {
    const fx = fixture();
    writeProject(fx, [{ ...entry("stitch"), whenToUse: "x".repeat(MANIFEST_CONSTANTS.WHEN_TO_USE_MAX_LENGTH) }]);
    expect(loadManifest(fx.paths, fx.repo)).toHaveLength(1);
  });

  test("Profile and hosts", () => {
    const fx = fixture();
    writeGlobal(fx, { entries: [entry("aws", "cli", { profile: "readonly", hosts: ["claude-code"], check: "aws sts get-caller-identity" })] });
    const [merged] = loadManifest(fx.paths, fx.repo);
    expect(merged?.profile).toBe("readonly");
    expect(merged?.hosts).toEqual(["claude-code"]);
    expect(merged?.check).toBe("aws sts get-caller-identity");
    expect(Object.keys(merged ?? {}).sort()).toEqual(["check", "hosts", "layer", "name", "profile", "required", "type", "whenToUse"]);
  });

  test.each([
    ["unknown field", { extra: 1 }],
    ["invalid profile", { profile: "a b" }],
    ["unknown host", { hosts: ["vim"] }],
    ["duplicate hosts", { hosts: ["opencode", "opencode"] }],
    ["multi-line whenToUse", { whenToUse: "a\nb" }],
    ["empty whenToUse", { whenToUse: "" }],
    ["non-boolean required", { required: "yes" }],
  ])("rejects %s", (_label, extra) => {
    const fx = fixture();
    writeGlobal(fx, { entries: [entry("watson", "mcp", extra)] });
    const error = failure(() => loadManifest(fx.paths, fx.repo));
    expect(error.message.startsWith("global layer: watson (mcp)")).toBe(true);
  });
});

describe("Manifest load errors", () => {
  test("Entry without a name", () => {
    const fx = fixture();
    writeProject(fx, [entry("a"), entry("b"), { type: "mcp", whenToUse: "x" }]);
    const error = failure(() => loadManifest(fx.paths, fx.repo));
    expect(error.message.startsWith("project layer:")).toBe(true);
    expect(error.message).toContain("entry #2");
  });

  test("Invalid JSON file", () => {
    const fx = fixture();
    writeGlobal(fx, "{ not json SECRET_PARSER_TEXT");
    const error = failure(() => loadManifest(fx.paths, fx.repo));
    expect(error.message).toBe("global layer: invalid JSON");
  });

  test("invalid project JSON", () => {
    const fx = fixture();
    writeFileSync(join(fx.repo, ".openspec-cascade.json"), "{oops");
    expect(failure(() => loadProjectLayer(fx.repo)).message.startsWith("project layer:")).toBe(true);
  });

  test("entries that is not a list", () => {
    const fx = fixture();
    writeProject(fx, []);
    writeFileSync(join(fx.repo, ".openspec-cascade.json"), JSON.stringify({ manifest: { entries: 5 } }));
    expect(failure(() => loadProjectLayer(fx.repo)).message.startsWith("project layer:")).toBe(true);
  });
});

describe("Manifest entry uniqueness", () => {
  test("Duplicate in one layer", () => {
    const fx = fixture();
    writeProject(fx, [entry("stitch"), entry("stitch")]);
    const error = failure(() => loadManifest(fx.paths, fx.repo));
    expect(error.message.startsWith("project layer:")).toBe(true);
    expect(error.message).toContain("stitch");
  });

  test("same name with different types is not a duplicate", () => {
    const fx = fixture();
    writeProject(fx, [entry("engram", "cli"), entry("engram", "mcp")]);
    expect(loadManifest(fx.paths, fx.repo)).toHaveLength(2);
  });
});

describe("Check command rules", () => {
  test.each([
    ["Unsafe check command", "aws sts get-caller-identity; rm -rf x"],
    ["Quoted check command", 'sh -c "id"'],
    ["single quote", "echo 'x'"],
    ["dollar", "echo $HOME"],
    ["pipe", "a | b"],
    ["ampersand", "a & b"],
    ["backtick", "a `b`"],
    ["redirect out", "a > b"],
    ["redirect in", "a < b"],
    ["line break", "a\nb"],
    ["blank", "   "],
  ])("%s", (_label, check) => {
    const fx = fixture();
    writeGlobal(fx, { entries: [entry("aws", "cli", { check })] });
    const error = failure(() => loadManifest(fx.paths, fx.repo));
    expect(error.message.startsWith("global layer:")).toBe(true);
    expect(error.message).toContain("aws");
  });

  test("a plain check is accepted", () => {
    const fx = fixture();
    writeGlobal(fx, { entries: [entry("gh", "cli", { check: "  gh auth status  " })] });
    expect(loadManifest(fx.paths, fx.repo)[0]?.check).toBe("  gh auth status  ");
  });
});
