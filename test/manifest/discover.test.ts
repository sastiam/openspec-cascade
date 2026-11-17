import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discover, type DiscoveryDeps, type DiscoveryPaths, type DiscoveryResult } from "../../src/manifest/discover";
import { ManifestError } from "../../src/manifest/load";

const TOKEN_ONE = "FAKE_TOKEN_1";
const TOKEN_TWO = "FAKE_TOKEN_2";
const URL_HOST = "example.com";

let root = "";
let home = "";
let repo = "";
let main = "";
let paths: DiscoveryPaths;

function put(file: string, content: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
}

function fakeDeps(common: string | undefined): DiscoveryDeps {
  return {
    which: (binary) => (binary === "gh" || binary === "bun" ? `/usr/bin/${binary}` : null),
    gitCommonDir: () => common,
  };
}

function find(result: DiscoveryResult, name: string, type: string): DiscoveryResult["candidates"][number] | undefined {
  return result.candidates.find((candidate) => candidate.name === name && candidate.type === type);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "discover-"));
  home = join(root, "home");
  repo = join(root, "repo");
  main = join(root, "main");
  for (const dir of [home, repo, main]) mkdirSync(dir, { recursive: true });
  paths = { home, xdgConfigHome: join(root, "cfg"), repo };
  const link = join(root, "link");
  symlinkSync(repo, link);
  put(join(home, ".claude.json"), {
    mcpServers: { watson: { command: "watson", env: { TOKEN: TOKEN_ONE } } },
    projects: {
      [link]: { mcpServers: { stitch: { url: `https://${URL_HOST}/s` } } },
      [main]: { mcpServers: { mainonly: {} } },
      [join(root, "gone")]: { mcpServers: { ghost: {} } },
    },
  });
  put(join(repo, ".mcp.json"), { mcpServers: { local: { args: [TOKEN_ONE] } } });
  put(join(home, ".claude", "skills", "gskill", "SKILL.md"), "x");
  put(join(repo, ".claude", "skills", "pskill", "SKILL.md"), "x");
  put(join(home, ".claude", "settings.json"), { enabledPlugins: { "egm@market": true, "off@market": true, "keep@market": true } });
  put(join(repo, ".claude", "settings.json"), { enabledPlugins: { "egm@market": false } });
  put(join(repo, ".claude", "settings.local.json"), { enabledPlugins: { "design@market": true } });
  put(join(paths.xdgConfigHome, "opencode", "opencode.json"), { mcp: { watson: { url: `https://${URL_HOST}/w` } } });
  put(join(repo, "opencode.jsonc"), `// note\n{ /* c */ "mcp": { "docs": { "url": "https://${URL_HOST}/mcp", }, }, }`);
  put(join(paths.xdgConfigHome, "opencode", "skill", "oskill", "SKILL.md"), "x");
  put(join(repo, ".opencode", "skills", "design-review", "SKILL.md"), "x");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("discover", () => {
  test("result and candidate keys", () => {
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(Object.keys(result).sort()).toEqual(["candidates", "skipped"]);
    expect(Object.keys(result.candidates[0] ?? {}).sort()).toEqual(["hosts", "inManifest", "name", "sources", "type"]);
  });

  test("Claude Code MCP: top level, project key through symlink, main worktree, .mcp.json", () => {
    const result = discover(paths, fakeDeps(join(main, ".git")));
    for (const name of ["watson", "stitch", "mainonly", "local"]) expect(find(result, name, "mcp")).toBeDefined();
    expect(find(result, "stitch", "mcp")?.hosts).toEqual(["claude-code"]);
  });

  test("Stale project key adds nothing and no skipped item", () => {
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(JSON.stringify(result)).not.toContain("ghost");
    expect(result.skipped).toEqual([]);
  });

  test("No git common folder matches the repository only", () => {
    const result = discover(paths, fakeDeps(undefined));
    expect(find(result, "stitch", "mcp")).toBeDefined();
    expect(find(result, "mainonly", "mcp")).toBeUndefined();
  });

  test("skills from Claude Code and OpenCode (skill and skills)", () => {
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(find(result, "gskill", "skill")?.hosts).toEqual(["claude-code"]);
    expect(find(result, "pskill", "skill")).toBeDefined();
    expect(find(result, "oskill", "skill")?.hosts).toEqual(["opencode"]);
    expect(find(result, "design-review", "skill")?.hosts).toEqual(["opencode"]);
  });

  test("plugins: project-enabled listed, project-disabled global plugin absent", () => {
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(find(result, "design", "plugin")).toBeDefined();
    expect(find(result, "keep", "plugin")).toBeDefined();
    expect(find(result, "egm", "plugin")).toBeUndefined();
  });

  test("OpenCode JSONC with comments, URL and trailing comma", () => {
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(find(result, "docs", "mcp")?.hosts).toEqual(["opencode"]);
    expect(JSON.stringify(result)).not.toContain(URL_HOST);
  });

  test("json wins over jsonc when both exist", () => {
    put(join(repo, "opencode.json"), { mcp: { fromjson: {} } });
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(find(result, "fromjson", "mcp")).toBeDefined();
    expect(find(result, "docs", "mcp")).toBeUndefined();
  });

  test("CLI tools found by which only", () => {
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(find(result, "gh", "cli")?.sources).toEqual(["PATH"]);
    expect(find(result, "bun", "cli")).toBeDefined();
    expect(find(result, "docker", "cli")).toBeUndefined();
  });

  test("same helper in two hosts merges hosts and sources", () => {
    const watson = find(discover(paths, fakeDeps(join(main, ".git"))), "watson", "mcp");
    expect(watson?.hosts).toEqual(["claude-code", "opencode"]);
    expect(watson?.sources).toEqual([join(root, "cfg", "opencode", "opencode.json"), "~/.claude.json"]);
  });

  test("XDG outside home: global OpenCode sources use the absolute path", () => {
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(find(result, "watson", "mcp")?.sources).toContain(join(paths.xdgConfigHome, "opencode", "opencode.json"));
    expect(find(result, "oskill", "skill")?.sources).toEqual([join(paths.xdgConfigHome, "opencode", "skill")]);
    expect(JSON.stringify(result)).not.toContain("~/.config/opencode");
  });

  test("XDG inside home: global OpenCode sources use ~", () => {
    const inside = { ...paths, xdgConfigHome: join(home, ".config") };
    put(join(inside.xdgConfigHome, "opencode", "opencode.json"), { mcp: { watson: {} } });
    put(join(inside.xdgConfigHome, "opencode", "skills", "hskill", "SKILL.md"), "x");
    const result = discover(inside, fakeDeps(join(main, ".git")));
    expect(find(result, "watson", "mcp")?.sources).toContain("~/.config/opencode/opencode.json");
    expect(find(result, "hskill", "skill")?.sources).toEqual(["~/.config/opencode/skills"]);
  });

  test("inManifest comes from the global layer", () => {
    put(join(paths.xdgConfigHome, "openspec-cascade", "manifest.json"), { entries: [{ name: "gh", type: "cli", whenToUse: "use gh" }] });
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(find(result, "gh", "cli")?.inManifest).toBe("global");
    expect(find(result, "bun", "cli")?.inManifest).toBeNull();
  });

  test("project layer wins for inManifest", () => {
    const entry = { name: "gh", type: "cli", whenToUse: "use gh" };
    put(join(paths.xdgConfigHome, "openspec-cascade", "manifest.json"), { entries: [entry] });
    put(join(repo, ".openspec-cascade.json"), { manifest: { entries: [entry] } });
    expect(find(discover(paths, fakeDeps(join(main, ".git"))), "gh", "cli")?.inManifest).toBe("project");
  });

  test("invalid manifest throws ManifestError naming the global layer", () => {
    put(join(paths.xdgConfigHome, "openspec-cascade", "manifest.json"), { entries: [{ name: "x", type: "service", whenToUse: "w" }] });
    expect(() => discover(paths, fakeDeps(join(main, ".git")))).toThrow(ManifestError);
    expect(() => discover(paths, fakeDeps(join(main, ".git")))).toThrow(/^global layer:/);
  });

  test("unreadable source is skipped with a fixed reason and no values", () => {
    put(join(paths.xdgConfigHome, "opencode", "opencode.json"), `{ "token": "${TOKEN_TWO}" `);
    const result = discover(paths, fakeDeps(join(main, ".git")));
    expect(result.skipped).toEqual([{ source: join(root, "cfg", "opencode", "opencode.json"), reason: "invalid JSON" }]);
    expect(Object.keys(result.skipped[0] ?? {}).sort()).toEqual(["reason", "source"]);
    expect(find(result, "docs", "mcp")).toBeDefined();
    expect(JSON.stringify(result)).not.toContain(TOKEN_TWO);
  });

  test("serialized result never contains secrets or URLs", () => {
    const text = JSON.stringify(discover(paths, fakeDeps(join(main, ".git"))));
    for (const secret of [TOKEN_ONE, TOKEN_TWO, URL_HOST]) expect(text).not.toContain(secret);
  });
});
