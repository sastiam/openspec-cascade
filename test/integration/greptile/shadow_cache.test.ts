import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, GreptileCache, GreptileCacheError, sha256 } from "../../../src/integration/greptile/cache";
import { ShadowCommitError, ShadowCommitManager } from "../../../src/integration/greptile/shadow";
import { createTempGitRepo, runGitCommand, type TempGitRepo } from "../../e2e/helpers/temp_repo";

async function repoState(repoDir: string): Promise<string[]> {
  const commands: string[][] = [
    ["rev-parse", "HEAD"],
    ["status", "--porcelain", "--untracked-files=all"],
    ["diff", "--cached"],
    ["diff"],
    ["for-each-ref"],
    ["worktree", "list", "--porcelain"],
    ["stash", "list"],
  ];
  return Promise.all(commands.map(async (args) => (await runGitCommand(repoDir, args)).stdout));
}

describe("ShadowCommitManager", () => {
  const repos: TempGitRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  async function dirtyRepo(): Promise<TempGitRepo> {
    const repo = await createTempGitRepo({ branch: "main", files: { "src/app.ts": "export const a = 1;\n", ".gitignore": "ignored.log\n" } });
    repos.push(repo);
    await runGitCommand(repo.repoDir, ["add", "-A"]);
    await runGitCommand(repo.repoDir, ["commit", "-m", "chore: base"]);
    await runGitCommand(repo.repoDir, ["checkout", "-b", "feat/shadow"]);
    writeFileSync(join(repo.repoDir, "src", "app.ts"), "export const a = 2;\n");
    writeFileSync(join(repo.repoDir, "staged.ts"), "export const s = 1;\n");
    await runGitCommand(repo.repoDir, ["add", "staged.ts"]);
    writeFileSync(join(repo.repoDir, "untracked.ts"), "export const u = 1;\n");
    writeFileSync(join(repo.repoDir, "ignored.log"), "noise\n");
    mkdirSync(join(repo.repoDir, ".cascade", "cache"), { recursive: true });
    writeFileSync(join(repo.repoDir, ".cascade", "cache", "entry.json"), "{}\n");
    return repo;
  }

  test("snapshots staged, unstaged and untracked work without mutating the repository", async () => {
    const repo = await dirtyRepo();
    const before = await repoState(repo.repoDir);
    const tempRoot = mkdtempSync(join(tmpdir(), "cascade-shadow-root-"));
    try {
      const manager = new ShadowCommitManager({ tempRoot });
      const files = await manager.withShadowCommit(repo.repoDir, async (sha, snapshot) => {
        expect(snapshot.parentSha).toBe((await runGitCommand(repo.repoDir, ["rev-parse", "HEAD"])).stdout);
        expect((await runGitCommand(repo.repoDir, ["show", `${sha}:src/app.ts`])).stdout).toBe("export const a = 2;");
        expect((await runGitCommand(repo.repoDir, ["for-each-ref", snapshot.ref])).stdout).toContain(sha);
        return (await runGitCommand(repo.repoDir, ["ls-tree", "-r", "--name-only", sha])).stdout.split("\n");
      });
      expect(files).toEqual(expect.arrayContaining(["src/app.ts", "staged.ts", "untracked.ts", ".gitignore"]));
      expect(files).not.toContain("ignored.log");
      expect(files.some((file) => file.startsWith(".cascade/"))).toBe(false);
      expect(await repoState(repo.repoDir)).toEqual(before);
      expect(readdirSync(tempRoot)).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("cleans the ref and temp index when the callback throws", async () => {
    const repo = await dirtyRepo();
    const before = await repoState(repo.repoDir);
    const tempRoot = mkdtempSync(join(tmpdir(), "cascade-shadow-root-"));
    try {
      await expect(
        new ShadowCommitManager({ tempRoot }).withShadowCommit(repo.repoDir, async () => {
          throw new Error("callback failed");
        }),
      ).rejects.toThrow("callback failed");
      expect(await repoState(repo.repoDir)).toEqual(before);
      expect(readdirSync(tempRoot)).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("shadow worktree exposes uncommitted work and is removed afterwards", async () => {
    const repo = await dirtyRepo();
    const before = await repoState(repo.repoDir);
    const manager = new ShadowCommitManager();
    let seenPath = "";
    await manager.withShadowWorktree(repo.repoDir, async (worktreePath, snapshot) => {
      seenPath = worktreePath;
      expect(existsSync(join(worktreePath, "untracked.ts"))).toBe(true);
      expect((await runGitCommand(worktreePath, ["rev-parse", "HEAD"])).stdout).toBe(snapshot.sha);
      const diff = await manager.branchDiff(repo.repoDir, "main", snapshot.sha);
      expect(diff.mergeBase).toBe((await runGitCommand(repo.repoDir, ["merge-base", "main", "HEAD"])).stdout);
      expect([...diff.files].sort()).toEqual(["src/app.ts", "staged.ts", "untracked.ts"]);
      expect(diff.patch).toContain("+export const a = 2;");
    });
    expect(existsSync(seenPath)).toBe(false);
    expect(await repoState(repo.repoDir)).toEqual(before);
  });

  test("works on a repository without commits and reports git failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cascade-shadow-empty-"));
    try {
      await runGitCommand(dir, ["init", "-q"]);
      await runGitCommand(dir, ["config", "commit.gpgsign", "false"]);
      writeFileSync(join(dir, "first.ts"), "export {};\n");
      const sha = await new ShadowCommitManager().withShadowCommit(dir, async (shadowSha, snapshot) => {
        expect(snapshot.parentSha).toBeNull();
        return shadowSha;
      });
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      await expect(new ShadowCommitManager().branchDiff(dir, "does-not-exist", sha)).rejects.toBeInstanceOf(ShadowCommitError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GreptileCache", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
  });

  function root(): string {
    const dir = mkdtempSync(join(tmpdir(), "cascade-greptile-cache-"));
    dirs.push(dir);
    return dir;
  }

  const key = { baseSha: "base", diffHash: sha256("diff"), query: "review" };

  test("stores under .cascade/cache/greptile with hits, misses and TTL expiry", () => {
    let now = 1_000;
    const cache = new GreptileCache<{ answer: number }>({ rootDir: root(), ttlMs: 100, now: () => now });
    expect(cache.dir.endsWith(join(".cascade", "cache", "greptile"))).toBe(true);
    expect(cache.get(key)).toBeUndefined();
    const entry = cache.set(key, { answer: 42 });
    expect(entry.key).toBe(cacheKey(key));
    expect(cache.get(key)).toEqual({ answer: 42 });
    expect(cache.get({ ...key, diffHash: sha256("other") })).toBeUndefined();
    now = 1_100;
    expect(cache.get(key)).toBeUndefined();
    expect(readdirSync(cache.dir)).toEqual([]);
  });

  test("keys are injective across component boundaries", () => {
    expect(cacheKey({ baseSha: "a", diffHash: "bc", query: "" })).not.toBe(cacheKey({ baseSha: "ab", diffHash: "c", query: "" }));
    expect(sha256("x")).toHaveLength(64);
  });

  test("corrupt entries are misses when fail-open and errors when fail-closed", () => {
    const dir = root();
    const open = new GreptileCache<number>({ rootDir: dir });
    open.set(key, 1);
    writeFileSync(join(open.dir, `${cacheKey(key)}.json`), "{not json");
    expect(open.get(key)).toBeUndefined();
    const closed = new GreptileCache<number>({ rootDir: dir, policy: "fail-closed" });
    expect(() => closed.get(key)).toThrow(GreptileCacheError);
    writeFileSync(join(open.dir, `${cacheKey(key)}.json`), JSON.stringify({ version: 1, key: "other", createdAt: 0, expiresAt: 9e15, value: 1 }));
    expect(() => closed.get(key)).toThrow("invalid entry envelope");
    const validating = new GreptileCache<number>({ rootDir: dir, policy: "fail-closed", validate: () => undefined });
    validating.set(key, 2);
    expect(() => validating.get(key)).toThrow("failed validation");
  });

  test("prune removes expired and unreadable entries only", () => {
    let now = 0;
    const cache = new GreptileCache<number>({ rootDir: root(), ttlMs: 10, now: () => now });
    expect(cache.prune()).toBe(0);
    cache.set(key, 1);
    cache.set({ ...key, query: "fresh" }, 2);
    writeFileSync(join(cache.dir, "garbage.json"), "x");
    now = 5;
    cache.set({ ...key, query: "later" }, 3);
    now = 12;
    expect(cache.prune()).toBe(3);
    expect(cache.get({ ...key, query: "later" })).toBe(3);
  });
});
