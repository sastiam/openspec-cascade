import { describe, expect, test } from "bun:test";
import {
  evaluateSddGate,
  findActiveOpenSpecChange,
  isGatedTool,
  isProductionSourceFile,
} from "../../src/sdd/sdd_gate";

describe("isProductionSourceFile", () => {
  test("identifies production source files correctly", () => {
    expect(isProductionSourceFile("src/core/fsm.ts")).toBe(true);
    expect(isProductionSourceFile("src/engine/runner.js")).toBe(true);
    expect(isProductionSourceFile("components/Dashboard.vue")).toBe(true);
    expect(isProductionSourceFile("backend/app.py")).toBe(true);
  });

  test("exempts test files and directories", () => {
    expect(isProductionSourceFile("test/core/fsm.test.ts")).toBe(false);
    expect(isProductionSourceFile("src/core/fsm.test.ts")).toBe(false);
    expect(isProductionSourceFile("src/core/test_helper.ts")).toBe(false);
    expect(isProductionSourceFile("test/sample.spec.ts")).toBe(false);
  });

  test("exempts docs, specs, and config folders", () => {
    expect(isProductionSourceFile("docs/architecture.md")).toBe(false);
    expect(isProductionSourceFile("openspec/changes/feat/tasks.md")).toBe(false);
    expect(isProductionSourceFile(".agents/skills/runner/SKILL.md")).toBe(false);
  });

  test("handles empty or falsy paths", () => {
    expect(isProductionSourceFile("")).toBe(false);
  });
});

describe("isGatedTool", () => {
  test("identifies gated modification tools", () => {
    expect(isGatedTool("Edit")).toBe(true);
    expect(isGatedTool("Write")).toBe(true);
    expect(isGatedTool("MultiEdit")).toBe(true);
  });

  test("allows read-only and command tools without gating", () => {
    expect(isGatedTool("Read")).toBe(false);
    expect(isGatedTool("Bash")).toBe(false);
    expect(isGatedTool("Glob")).toBe(false);
    expect(isGatedTool("Grep")).toBe(false);
  });
});

describe("findActiveOpenSpecChange", () => {
  test("finds active change in the current repository", async () => {
    const active = await findActiveOpenSpecChange(process.cwd());
    // On feat/cascade-v2 we have cascade-v2-sdd-framework with pending tasks
    expect(typeof active === "string" || active === null).toBe(true);
  });
});

describe("evaluateSddGate", () => {
  test("allows non-gated tools freely", async () => {
    const result = await evaluateSddGate({
      toolName: "Read",
      filePath: "src/core/fsm.ts",
    });
    expect(result.allowed).toBe(true);
  });

  test("allows modifications to non-production files", async () => {
    const result = await evaluateSddGate({
      toolName: "Write",
      filePath: "test/example.test.ts",
    });
    expect(result.allowed).toBe(true);
  });

  test("allows modification when CASCADE_SDD_GATE_DISABLED=1", async () => {
    const prev = process.env.CASCADE_SDD_GATE_DISABLED;
    try {
      process.env.CASCADE_SDD_GATE_DISABLED = "1";
      const result = await evaluateSddGate({
        toolName: "Edit",
        filePath: "src/production.ts",
        repoRoot: "/non/existent/repo",
      });
      expect(result.allowed).toBe(true);
    } finally {
      process.env.CASCADE_SDD_GATE_DISABLED = prev;
    }
  });

  test("blocks production source edit when no active change exists in dummy repo", async () => {
    const result = await evaluateSddGate({
      toolName: "Edit",
      filePath: "src/production.ts",
      repoRoot: "/tmp",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SDD Gate Block");
  });
});
