import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatHelp } from "../../config";
import { CLI_COMMAND_CONSTANTS, ENGINE_CONSTANTS } from "../../src/config/constants";
import { getDefaultSpawner } from "../../src/runtime";

const ROOT = join(import.meta.dir, "..", "..");
const cliDoc = readFileSync(join(ROOT, "docs", "cli.md"), "utf8");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

describe("CLI documentation parity", () => {
  test("every flag in --help is documented in docs/cli.md", () => {
    const flags = [...new Set(formatHelp().match(/--[a-z][a-z-]*/g) ?? [])];
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.filter((flag) => !cliDoc.includes(flag))).toEqual([]);
  });

  test("every subcommand and engine is documented in docs/cli.md and the README", () => {
    for (const subcommand of CLI_COMMAND_CONSTANTS.SUBCOMMANDS) {
      expect(cliDoc).toContain(`\`${subcommand}\``);
      expect(readme).toContain(`cascade.ts ${subcommand}`);
    }
    for (const engine of [...ENGINE_CONSTANTS.SUPPORTED_ENGINES, ...Object.keys(ENGINE_CONSTANTS.ENGINE_ALIASES)]) {
      expect(cliDoc).toContain(`\`${engine}\``);
      expect(readme).toContain(`\`${engine}\``);
    }
  });

  test("docs describe dual-runtime execution and CI installation", () => {
    for (const doc of [cliDoc, readme]) {
      expect(doc).toContain("node --import ./scripts/node_ts_register.mjs cascade.ts");
      expect(doc).toContain("ci/github-workflows/ci.yml");
      expect(doc).toContain("--mode v2");
    }
  });
});

describe("run_looper.sh", () => {
  test("is valid bash and rejects unknown runtimes fail-closed", async () => {
    const spawner = getDefaultSpawner();
    expect((await spawner.run(["bash", "-n", join(ROOT, "run_looper.sh")])).exitCode).toBe(0);
    const result = await spawner.run(["bash", join(ROOT, "run_looper.sh")], {
      env: { PATH: process.env.PATH, CASCADE_RUNTIME: "ruby" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("CASCADE_RUNTIME must be");
  });

  test("forwards mode, engine and extra flags to the CLI", async () => {
    const result = await getDefaultSpawner().run(["bash", join(ROOT, "run_looper.sh"), "--help"], {
      env: { PATH: process.env.PATH, CASCADE_RUNTIME: "bun", CASCADE_LOOPER_MODE: "v2" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--mode <v1|v2>");
  });
});
