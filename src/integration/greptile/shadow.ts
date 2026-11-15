/**
 * Ephemeral shadow commits: snapshot the working tree (tracked + untracked, honouring
 * `.gitignore`) into a dangling commit without touching the user's index, HEAD,
 * branches or working tree.
 *
 * An isolated `GIT_INDEX_FILE` in a temp directory receives `read-tree HEAD` and
 * `add -A`; `write-tree` + `commit-tree` produce the snapshot. A private ref under
 * `refs/cascade/shadow/` protects the object from `gc` while the callback runs and is
 * deleted, together with the temp index, in `finally`.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_CODE_CONSTANTS, GREPTILE_CONSTANTS } from "../../config/constants";
import { getDefaultSpawner } from "../../runtime/spawner";
import type { ISpawner } from "../../runtime/types";

export class ShadowCommitError extends Error {
  readonly step: string;

  constructor(step: string, message: string) {
    super(`shadow commit failed at "${step}": ${message}`);
    this.name = "ShadowCommitError";
    this.step = step;
  }
}

export interface ShadowSnapshot {
  readonly sha: string;
  readonly parentSha: string | null;
  readonly ref: string;
}

export interface BranchDiff {
  readonly mergeBase: string;
  readonly files: readonly string[];
  readonly patch: string;
}

export interface ShadowCommitManagerOptions {
  readonly spawner?: ISpawner;
  readonly tempRoot?: string;
  readonly timeoutMs?: number;
}

export class ShadowCommitManager {
  private readonly spawner: ISpawner;
  private readonly tempRoot: string;
  private readonly timeoutMs?: number;

  constructor(options: ShadowCommitManagerOptions = {}) {
    this.spawner = options.spawner ?? getDefaultSpawner();
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.timeoutMs = options.timeoutMs;
  }

  /**
   * Creates a shadow snapshot, runs `fn(shadowSha)`, and always removes the temp index and shadow ref.
   */
  async withShadowCommit<T>(repoPath: string, fn: (shadowSha: string, snapshot: ShadowSnapshot) => Promise<T>): Promise<T> {
    const indexDir = mkdtempSync(join(this.tempRoot, GREPTILE_CONSTANTS.SHADOW_INDEX_PREFIX));
    const ref = `${GREPTILE_CONSTANTS.SHADOW_REF_PREFIX}${randomUUID()}`;
    let refCreated = false;
    try {
      const snapshot = await this.snapshot(repoPath, join(indexDir, GREPTILE_CONSTANTS.SHADOW_INDEX_FILENAME), ref);
      refCreated = true;
      return await fn(snapshot.sha, snapshot);
    } finally {
      if (refCreated) {
        await this.git(repoPath, ["update-ref", "-d", ref]).catch(() => undefined);
      }
      rmSync(indexDir, { recursive: true, force: true });
    }
  }

  /**
   * Snapshots the working tree and checks the snapshot out in a temporary detached worktree, so tools that
   * only review committed changes on a checked-out HEAD (such as the Greptile CLI) see uncommitted work.
   * The worktree, its administrative metadata, the shadow ref and the temp index are always removed.
   */
  async withShadowWorktree<T>(
    repoPath: string,
    fn: (worktreePath: string, snapshot: ShadowSnapshot) => Promise<T>,
  ): Promise<T> {
    return this.withShadowCommit(repoPath, async (sha, snapshot) => {
      const parentDir = mkdtempSync(join(this.tempRoot, GREPTILE_CONSTANTS.SHADOW_WORKTREE_PREFIX));
      const worktreePath = join(parentDir, GREPTILE_CONSTANTS.SHADOW_INDEX_FILENAME);
      try {
        await this.gitOrThrow(repoPath, ["worktree", "add", "--detach", "--quiet", worktreePath, sha], "worktree add");
        return await fn(worktreePath, snapshot);
      } finally {
        await this.git(repoPath, ["worktree", "remove", "--force", worktreePath]).catch(() => undefined);
        await this.git(repoPath, ["worktree", "prune"]).catch(() => undefined);
        rmSync(parentDir, { recursive: true, force: true });
      }
    });
  }

  /**
   * Computes the merge-base between `baseRef` and `headSha` and the changed files/patch between them.
   */
  async branchDiff(repoPath: string, baseRef: string, headSha: string): Promise<BranchDiff> {
    const mergeBase = (await this.gitOrThrow(repoPath, ["merge-base", baseRef, headSha], "merge-base")).trim();
    const files = (await this.gitOrThrow(repoPath, ["diff", "--name-only", mergeBase, headSha], "diff --name-only"))
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean);
    const patch = await this.gitOrThrow(repoPath, ["diff", "--no-color", mergeBase, headSha], "diff");
    return { mergeBase, files, patch };
  }

  private async snapshot(repoPath: string, indexFile: string, ref: string): Promise<ShadowSnapshot> {
    const env = {
      ...process.env,
      GIT_INDEX_FILE: indexFile,
      GIT_AUTHOR_NAME: GREPTILE_CONSTANTS.SHADOW_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: GREPTILE_CONSTANTS.SHADOW_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: GREPTILE_CONSTANTS.SHADOW_AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: GREPTILE_CONSTANTS.SHADOW_AUTHOR_EMAIL,
    };
    const head = await this.git(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    const parentSha = head.exitCode === EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS ? head.stdout.trim() : null;
    if (parentSha !== null) {
      await this.gitOrThrow(repoPath, ["read-tree", parentSha], "read-tree", env);
    }
    await this.gitOrThrow(repoPath, ["add", "-A"], "add", env);
    const tree = (await this.gitOrThrow(repoPath, ["write-tree"], "write-tree", env)).trim();
    const parentArgs = parentSha === null ? [] : ["-p", parentSha];
    const sha = (
      await this.gitOrThrow(repoPath, ["commit-tree", tree, ...parentArgs, "-m", GREPTILE_CONSTANTS.SHADOW_COMMIT_MESSAGE], "commit-tree", env)
    ).trim();
    await this.gitOrThrow(repoPath, ["update-ref", ref, sha], "update-ref");
    return { sha, parentSha, ref };
  }

  private git(
    repoPath: string,
    args: readonly string[],
    env?: Record<string, string | undefined>,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.spawner.run(["git", ...args], { cwd: repoPath, env, timeoutMs: this.timeoutMs });
  }

  private async gitOrThrow(
    repoPath: string,
    args: readonly string[],
    step: string,
    env?: Record<string, string | undefined>,
  ): Promise<string> {
    const result = await this.git(repoPath, args, env);
    if (result.exitCode !== EXIT_CODE_CONSTANTS.EXIT_CODE_SUCCESS) {
      throw new ShadowCommitError(step, result.stderr.trim() || `exit ${result.exitCode}`);
    }
    return result.stdout;
  }
}
