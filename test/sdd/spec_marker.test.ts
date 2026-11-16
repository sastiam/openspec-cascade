import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeChangeHash, evaluateStage, parseMarker, renderMarker } from "../../src/sdd/spec_marker";

const SHA256_HEX_LENGTH = 64;
const SAMPLE_HASH = "a".repeat(SHA256_HEX_LENGTH);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

function makeChange(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "spec-marker-"));
  dirs.push(dir);
  writeFileSync(join(dir, ".keep"), "");
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, relative)), { recursive: true });
    writeFileSync(join(dir, relative), content);
  }
  return dir;
}

const BASE_FILES = {
  "proposal.md": "# Why\nBecause.\n",
  "design.md": "# Design\nHow.\n",
  "tasks.md": "- [ ] 1. first\n- [ ] 2. second\n",
  "specs/cap/spec.md": "## ADDED Requirements\n### Requirement: A\nThe system SHALL do A.\n",
};

describe("computeChangeHash", () => {
  test("ignores task checkbox state", () => {
    const open = makeChange(BASE_FILES);
    const done = makeChange({ ...BASE_FILES, "tasks.md": "- [x] 1. first\n- [X] 2. second\n" });
    expect(computeChangeHash(done)).toBe(computeChangeHash(open));
  });

  test("ignores CRLF line endings", () => {
    const lf = makeChange(BASE_FILES);
    const crlf = makeChange({ ...BASE_FILES, "design.md": "# Design\r\nHow.\r\n" });
    expect(computeChangeHash(crlf)).toBe(computeChangeHash(lf));
  });

  test("changes when design.md changes", () => {
    const before = makeChange(BASE_FILES);
    const after = makeChange({ ...BASE_FILES, "design.md": "# Design\nDifferent.\n" });
    expect(computeChangeHash(after)).not.toBe(computeChangeHash(before));
  });

  test("changes when a task is reworded", () => {
    const before = makeChange(BASE_FILES);
    const after = makeChange({ ...BASE_FILES, "tasks.md": "- [ ] 1. first\n- [ ] 2. third\n" });
    expect(computeChangeHash(after)).not.toBe(computeChangeHash(before));
  });

  test("does not depend on review.md or drift.md", () => {
    const before = makeChange(BASE_FILES);
    const after = makeChange({ ...BASE_FILES, "review.md": "report", "drift.md": "report" });
    expect(computeChangeHash(after)).toBe(computeChangeHash(before));
  });
});

describe("parseMarker and renderMarker", () => {
  const marker = { stage: "review", status: "resolved", hash: SAMPLE_HASH } as const;

  test("round-trips", () => {
    expect(parseMarker(`${renderMarker(marker)}\n# Report\n`)).toEqual(marker);
  });

  test("returns undefined without a front matter block", () => {
    expect(parseMarker("# Report\nno block\n")).toBeUndefined();
  });

  test("returns undefined for an unknown status", () => {
    expect(parseMarker(`---\negm: review\nstatus: maybe\nhash: ${SAMPLE_HASH}\n---\n`)).toBeUndefined();
  });
});

describe("evaluateStage", () => {
  test("reports missing when review.md does not exist", () => {
    expect(evaluateStage(makeChange(BASE_FILES), "review")).toEqual({ ok: false, reason: "missing" });
  });

  test("reports malformed when review.md has no block", () => {
    const dir = makeChange({ ...BASE_FILES, "review.md": "# Report only\n" });
    expect(evaluateStage(dir, "review")).toEqual({ ok: false, reason: "malformed" });
  });

  test("reports open when status is open", () => {
    const dir = makeChange(BASE_FILES);
    const hash = computeChangeHash(dir);
    writeFileSync(join(dir, "review.md"), renderMarker({ stage: "review", status: "open", hash }));
    expect(evaluateStage(dir, "review")).toEqual({ ok: false, reason: "open" });
  });

  test("reports stale after design.md is edited", () => {
    const dir = makeChange(BASE_FILES);
    const hash = computeChangeHash(dir);
    writeFileSync(join(dir, "review.md"), renderMarker({ stage: "review", status: "resolved", hash }));
    writeFileSync(join(dir, "design.md"), "# Design\nEdited after review.\n");
    expect(evaluateStage(dir, "review")).toEqual({ ok: false, reason: "stale" });
  });

  test("is ok when resolved and fresh, even after tasks are checked off", () => {
    const dir = makeChange(BASE_FILES);
    const hash = computeChangeHash(dir);
    writeFileSync(join(dir, "review.md"), renderMarker({ stage: "review", status: "resolved", hash }));
    writeFileSync(join(dir, "tasks.md"), "- [x] 1. first\n- [x] 2. second\n");
    expect(evaluateStage(dir, "review")).toEqual({ ok: true });
  });

  test("checks the drift stage against drift.md", () => {
    const dir = makeChange(BASE_FILES);
    const hash = computeChangeHash(dir);
    writeFileSync(join(dir, "review.md"), renderMarker({ stage: "review", status: "resolved", hash }));
    expect(evaluateStage(dir, "drift")).toEqual({ ok: false, reason: "missing" });
  });
});
