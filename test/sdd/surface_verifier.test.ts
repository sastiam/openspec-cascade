import { describe, expect, test } from "bun:test";
import { classifySurfaces } from "../../src/sdd/surface_verifier";

describe("classifySurfaces", () => {
  test("identifies frontend UI surfaces and adds frontend checks", () => {
    const report = classifySurfaces([
      "components/Header.vue",
      "styles/main.css",
      "pages/index.tsx",
    ]);

    expect(report.surfaces.frontend).toBe(true);
    expect(report.surfaces.backend).toBe(false);
    expect(report.surfaces.core).toBe(false);
    expect(report.detectedFiles.frontend).toHaveLength(3);
    expect(report.recommendedChecks).toContain("sdd-verify:frontend-render-check");
  });

  test("identifies backend API surfaces and adds contract checks", () => {
    const report = classifySurfaces([
      "src/server/routes/users.ts",
      "src/controllers/auth.ts",
    ]);

    expect(report.surfaces.backend).toBe(true);
    expect(report.surfaces.frontend).toBe(false);
    expect(report.detectedFiles.backend).toHaveLength(2);
    expect(report.recommendedChecks).toContain("sdd-verify:api-contract-smoke");
  });

  test("identifies core library surfaces and retains default verification", () => {
    const report = classifySurfaces([
      "src/core/fsm.ts",
      "src/storage/memory.ts",
    ]);

    expect(report.surfaces.core).toBe(true);
    expect(report.surfaces.frontend).toBe(false);
    expect(report.surfaces.backend).toBe(false);
    expect(report.recommendedChecks).toContain("bun test");
  });

  test("classifies mixed multi-surface changes", () => {
    const report = classifySurfaces([
      "components/App.vue",
      "src/routes/api.ts",
      "src/core/dag.ts",
    ]);

    expect(report.surfaces.frontend).toBe(true);
    expect(report.surfaces.backend).toBe(true);
    expect(report.surfaces.core).toBe(true);
    expect(report.recommendedChecks).toContain("sdd-verify:frontend-render-check");
    expect(report.recommendedChecks).toContain("sdd-verify:api-contract-smoke");
  });
});
