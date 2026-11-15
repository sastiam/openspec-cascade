# Spec: Ephemeral Shadow Commits

## ADDED Requirements

### Requirement: Zero-Mutation Shadow Snapshot
The system MUST snapshot tracked and untracked (non-ignored) working-tree content into a commit using an isolated `GIT_INDEX_FILE`, leaving `HEAD`, the user's index, branches, tags and working tree unchanged.

#### Scenario: Repository state is preserved
- **WHEN** `withShadowCommit` runs on a repository with staged, unstaged and untracked changes
- **THEN** the callback receives a commit containing all three, and afterwards `git status --porcelain`, `git rev-parse HEAD`, `git diff --cached` and `git for-each-ref` are identical to before

#### Scenario: Cleanup on failure
- **WHEN** the callback throws
- **THEN** the error propagates, the shadow ref is deleted and the temp index directory no longer exists

### Requirement: Shadow Worktree and Branch Diff
The system MUST expose the snapshot through a temporary detached worktree and compute the merge-base diff (files and patch) between a base ref and the snapshot.

#### Scenario: Worktree is removed
- **WHEN** `withShadowWorktree` completes
- **THEN** `git worktree list` shows only the original worktree

#### Scenario: Branch diff includes uncommitted files
- **WHEN** `branchDiff(repo, "main", shadowSha)` runs on a feature branch with an uncommitted new file
- **THEN** the files list contains that file and `mergeBase` equals `git merge-base main HEAD`
