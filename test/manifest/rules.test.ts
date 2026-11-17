import { describe, expect, test } from "bun:test";
import { SUGGESTED_RULES_YAML, writeRules } from "../../src/manifest/rules";

describe("SUGGESTED_RULES_YAML", () => {
  test("has the expected shape", () => {
    expect(SUGGESTED_RULES_YAML.startsWith("rules:")).toBe(true);
    expect(SUGGESTED_RULES_YAML).toContain("  tasks:");
    expect(SUGGESTED_RULES_YAML).toContain("  design:");
    expect(SUGGESTED_RULES_YAML).toContain("manual.md");
    expect(SUGGESTED_RULES_YAML.endsWith("\n")).toBe(true);
  });
});

describe("writeRules", () => {
  test("appends the template when there is no rules key", () => {
    const original = "# comment\nschema: spec-driven\n";
    const result = writeRules(original);
    expect(result).toEqual({ text: `${original}${SUGGESTED_RULES_YAML}` });
  });

  test("refuses a plain rules key", () => {
    const result = writeRules("schema: spec-driven\nrules:\n  tasks: []\n");
    expect("refused" in result).toBe(true);
  });

  test("refuses a double-quoted rules key", () => {
    const result = writeRules('schema: spec-driven\n"rules":\n  tasks: []\n');
    expect("refused" in result).toBe(true);
  });

  test("refuses a single-quoted rules key", () => {
    const result = writeRules("'rules':\n  tasks: []\n");
    expect("refused" in result).toBe(true);
  });

  test("appends when rules is only commented out", () => {
    const original = "schema: spec-driven\n# rules:\n";
    const result = writeRules(original);
    expect(result).toEqual({ text: `${original}${SUGGESTED_RULES_YAML}` });
  });

  test("adds a line break when the file lacks a final one", () => {
    const result = writeRules("schema: spec-driven");
    expect(result).toEqual({ text: `schema: spec-driven\n${SUGGESTED_RULES_YAML}` });
  });
});
