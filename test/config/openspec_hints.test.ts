import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OPENSPEC_PROPOSE_HINT } from "../../src/config/constants";

const FACADE = join(import.meta.dir, "..", "..", "src", "facade", "cascade_facade.ts");

describe("OPENSPEC_PROPOSE_HINT", () => {
  test("names propose in both forms", () => {
    expect(OPENSPEC_PROPOSE_HINT).toContain("/opsx:propose");
    expect(OPENSPEC_PROPOSE_HINT).toContain("/opsx-propose");
  });

  test("the facade uses the constant instead of a literal command name", () => {
    const source = readFileSync(FACADE, "utf8");
    expect(source).not.toContain("/opsx:propose");
    expect(source).toContain("OPENSPEC_PROPOSE_HINT");
  });
});
