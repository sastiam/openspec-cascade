import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyCliFailure,
  estimateTokens,
  formatGreptileContext,
  GreptileCliClient,
  GreptileError,
  GreptileReviewBridge,
  parseReviewOutput,
  rankFindings,
  sortFindingsBySeverity,
  toRawFindings,
  type GreptileFinding,
} from "../../../src/integration/greptile";
import { normalizeReviewPath, reviewFilesFromFindings } from "../../../src/sdd/review_verifier";
import { createTempGitRepo, runGitCommand, type TempGitRepo } from "../../e2e/helpers/temp_repo";

const REVIEW_JSON = JSON.stringify({
  summary: "Two issues",
  confidence: 4,
  comments: [
    { path: "src/auth/token.ts", startLine: 3, endLine: 5, severity: "low", securityIssue: true, body: "Token refresh leaks the secret" },
    { path: "README.md", body: "Typo in heading", extra: "ignored" },
  ],
});

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

function executable(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cascade-greptile-bin-"));
  dirs.push(dir);
  const path = join(dir, "greptile");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function steppingClock(stepMs: number): () => number {
  let now = 0;
  return () => (now += stepMs);
}

describe("parseReviewOutput", () => {
  test("normalizes documented comments and raises security severity", () => {
    const parsed = parseReviewOutput(REVIEW_JSON);
    expect(parsed.summary).toBe("Two issues");
    expect(parsed.findings).toEqual([
      { file: "src/auth/token.ts", line: 3, endLine: 5, severity: "high", securityIssue: true, message: "Token refresh leaks the secret" },
      { file: "README.md", line: undefined, endLine: undefined, severity: "medium", securityIssue: false, message: "Typo in heading" },
    ]);
    expect(parseReviewOutput("{}").findings).toEqual([]);
    expect(parseReviewOutput(JSON.stringify({ comments: [{ path: "a", body: "x", severity: "critical" }] })).findings[0]?.severity).toBe("critical");
  });

  test("fails closed on non-JSON and schema violations", () => {
    expect(() => parseReviewOutput("Reviewing…")).toThrow(GreptileError);
    try {
      parseReviewOutput(JSON.stringify({ comments: [{ path: "", body: 1 }] }));
    } catch (error) {
      expect((error as GreptileError).kind).toBe("invalid_output");
      expect((error as GreptileError).retryable).toBe(false);
    }
  });
});

describe("GreptileCliClient against real executables", () => {
  test("review passes documented flags and parses stdout", async () => {
    const bin = executable(`[ "$1 $2 $3 $4" = "review --json --branch main" ] || { echo "bad args: $*" >&2; exit 9; }\ncat <<'JSON'\n${REVIEW_JSON}\nJSON`);
    const client = new GreptileCliClient({ binary: bin, now: steppingClock(12_000) });
    const result = await client.review({ repoPath: process.cwd(), baseBranch: "main" });
    expect(result.findings).toHaveLength(2);
    expect(result.elapsedMs).toBe(12_000);
  });

  test("classifies auth, rate limit, generic failures and missing binaries", async () => {
    const auth = new GreptileCliClient({ binary: executable('echo "You are not signed in. Run greptile login" >&2; exit 1') });
    await expect(auth.review({ repoPath: process.cwd() })).rejects.toMatchObject({ kind: "auth", retryable: false });
    const limited = new GreptileCliClient({ binary: executable('echo "429 rate limit" >&2; exit 1') });
    await expect(limited.review({ repoPath: process.cwd() })).rejects.toMatchObject({ kind: "rate_limit", retryable: true });
    const broken = new GreptileCliClient({ binary: executable('echo "boom" >&2; exit 7') });
    await expect(broken.review({ repoPath: process.cwd() })).rejects.toMatchObject({ kind: "command_failed", exitCode: 7 });
    const missing = new GreptileCliClient({ binary: "/nonexistent/greptile" });
    await expect(missing.review({ repoPath: process.cwd() })).rejects.toMatchObject({ kind: "not_installed" });
    const slow = new GreptileCliClient({ binary: executable("sleep 5"), timeoutMs: 100 });
    await expect(slow.review({ repoPath: process.cwd() })).rejects.toMatchObject({ kind: "timeout", retryable: true });
  });

  test("checkStatus reports installation and authentication", async () => {
    expect(await new GreptileCliClient({ binary: "/nonexistent/greptile" }).checkStatus()).toMatchObject({ installed: false, authenticated: false });
    const signedOut = executable('case "$1" in --version) echo "3.8.0";; whoami) echo "not signed in" >&2; exit 1;; esac');
    expect(await new GreptileCliClient({ binary: signedOut }).checkStatus()).toMatchObject({ installed: true, authenticated: false, version: "3.8.0", detail: "not signed in" });
    const signedIn = executable('case "$1" in --version) echo "3.8.0";; whoami) echo "dev@example.invalid";; esac');
    expect(await new GreptileCliClient({ binary: signedIn }).checkStatus()).toMatchObject({ installed: true, authenticated: true, detail: "dev@example.invalid" });
  });

  test("reviewStatus maps documented exit codes", async () => {
    for (const [code, state] of [[0, "completed"], [1, "none"], [3, "running"], [4, "failed"], [5, "cancelled"], [42, "unknown"]] as const) {
      const bin = executable(`[ "$1 $2 $3 $4 $5" = "review status --json --commit abc" ] || exit 99\necho '{"state":"x"}'\nexit ${code}`);
      const result = await new GreptileCliClient({ binary: bin }).reviewStatus({ repoPath: process.cwd(), commit: "abc" });
      expect(result).toMatchObject({ state, exitCode: code, raw: { state: "x" } });
    }
    const plain = await new GreptileCliClient({ binary: executable("echo not-json") }).reviewStatus({ repoPath: process.cwd() });
    expect(plain.raw).toBe("not-json");
  });

  test("query ranks findings by relevance and severity", async () => {
    const findings = parseReviewOutput(REVIEW_JSON).findings;
    const ranked = await new GreptileCliClient().query({ question: "token refresh in auth module", findings });
    expect(ranked.map((entry) => entry.finding.file)).toEqual(["src/auth/token.ts"]);
    expect(ranked[0]?.score).toBeGreaterThan(0);
    expect(rankFindings("heading typo readme", findings, 1)).toHaveLength(1);
    expect(classifyCliFailure({ exitCode: 1, stdout: "", stderr: "", timedOut: false, aborted: false }, "x").kind).toBe("command_failed");
  });
});

describe("formatGreptileContext", () => {
  const findings: GreptileFinding[] = Array.from({ length: 30 }, (_, index) => ({
    file: `src/file${index}.ts`,
    line: index,
    severity: index % 3 === 0 ? "critical" : "low",
    securityIssue: index === 0,
    message: `Finding number ${index} with some explanatory text`,
  }));

  test("orders by severity, respects the budget and reports omissions", () => {
    const budget = 120;
    const context = formatGreptileContext(findings, budget);
    expect(estimateTokens(context)).toBeLessThanOrEqual(budget);
    expect(context.startsWith("## Greptile semantic context")).toBe(true);
    expect(context.split("\n")[1]).toContain("[critical] [security] src/file0.ts:0");
    expect(context).toMatch(/more finding\(s\) omitted \(token budget 120\)$/);
    expect(formatGreptileContext(findings, 100_000).split("\n")).toHaveLength(31);
    expect(formatGreptileContext([], 100)).toBe("");
    expect(formatGreptileContext(findings, 1)).toBe("");
    expect(sortFindingsBySeverity(findings)[0]?.severity).toBe("critical");
  });
});

describe("GreptileReviewBridge", () => {
  const repos: TempGitRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  async function featureRepo(): Promise<TempGitRepo> {
    const repo = await createTempGitRepo({ branch: "main", files: { "src/app.ts": "export const a = 1;\n" } });
    repos.push(repo);
    await runGitCommand(repo.repoDir, ["add", "-A"]);
    await runGitCommand(repo.repoDir, ["commit", "-m", "chore: base"]);
    await runGitCommand(repo.repoDir, ["checkout", "-b", "feat/review"]);
    writeFileSync(join(repo.repoDir, "src", "feature.ts"), "export const feature = true;\n");
    return repo;
  }

  const reviewingScript = (logFile: string): string =>
    executable(
      [
        `echo "$PWD" >> ${logFile}`,
        '[ -f src/feature.ts ] || { echo "shadow worktree missing uncommitted file" >&2; exit 8; }',
        `echo '{"summary":"ok","comments":[{"path":"src/feature.ts","startLine":1,"severity":"high","body":"Missing input validation"}]}'`,
      ].join("\n"),
    );

  test("reviews uncommitted work in a shadow worktree, verifies, caches and reuses the result", async () => {
    const repo = await featureRepo();
    const logFile = join(repo.homeDir, "invocations.log");
    const client = new GreptileCliClient({ binary: reviewingScript(logFile), now: steppingClock(11_000) });
    const bridge = new GreptileReviewBridge({ client, tokenBudget: 500 });
    const first = await bridge.review({ repoPath: repo.repoDir, baseBranch: "main" });
    expect(first.cached).toBe(false);
    expect(first.verification).toMatchObject({ valid: true, status: "ok", blockingFindingsCount: 1 });
    expect(first.diffFiles).toEqual(["src/feature.ts"]);
    expect(first.context).toContain("[high] src/feature.ts:1");
    const second = await bridge.review({ repoPath: repo.repoDir, baseBranch: "main" });
    expect(second.cached).toBe(true);
    expect(second.verification).toEqual(first.verification);
    const invocations = (await Bun.file(logFile).text()).trim().split("\n");
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).not.toBe(repo.repoDir);
    expect((await runGitCommand(repo.repoDir, ["status", "--porcelain"])).stdout.split("\n")).toEqual(["?? .cascade/", "?? src/feature.ts"]);
    expect((await runGitCommand(repo.repoDir, ["worktree", "list"])).stdout.split("\n")).toHaveLength(1);
  });

  test("rejects stale responses and mismatched findings without caching", async () => {
    const repo = await featureRepo();
    const fast = new GreptileCliClient({ binary: reviewingScript(join(repo.homeDir, "fast.log")), now: steppingClock(1_000) });
    const stale = await new GreptileReviewBridge({ client: fast }).review({ repoPath: repo.repoDir, baseBranch: "main" });
    expect(stale.verification.status).toBe("stale");
    const elsewhere = executable(`echo '{"comments":[{"path":"docs/other.md","body":"unrelated"}]}'`);
    const mismatchClient = new GreptileCliClient({ binary: elsewhere, now: steppingClock(11_000) });
    const mismatch = await new GreptileReviewBridge({ client: mismatchClient }).review({ repoPath: repo.repoDir, baseBranch: "main" });
    expect(mismatch.verification.status).toBe("mismatch");
    expect(mismatch.cached).toBe(false);
  });

  test("empty branch diffs skip the CLI entirely", async () => {
    const repo = await createTempGitRepo({ branch: "main" });
    repos.push(repo);
    const never = new GreptileCliClient({ binary: "/nonexistent/greptile" });
    const result = await new GreptileReviewBridge({ client: never }).review({ repoPath: repo.repoDir, baseBranch: "main" });
    expect(result.verification.status).toBe("empty");
    expect(result.context).toBe("");
  });

  test("review_verifier helpers normalize finding paths", () => {
    expect(normalizeReviewPath("./Src\\App.ts ")).toBe("src/app.ts");
    expect(reviewFilesFromFindings(toRawFindings(parseReviewOutput(REVIEW_JSON).findings))).toEqual(["src/auth/token.ts", "readme.md"]);
    expect(toRawFindings(parseReviewOutput(REVIEW_JSON).findings)[0]?.message).toStartWith("security:");
  });
});
