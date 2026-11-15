import { resolve } from "node:path";

const REPO_ROOT_PATH = resolve(import.meta.dir, "..", "..", "..");

export const E2E_CONSTANTS = {
  REPO_ROOT: REPO_ROOT_PATH,
  CASCADE_ENTRYPOINT: resolve(REPO_ROOT_PATH, "cascade.ts"),
  SDD_GATE_HOOK: resolve(REPO_ROOT_PATH, "plugins", "cascade", "hooks", "sdd_gate.mjs"),
  INSTALLER_SCRIPT: resolve(REPO_ROOT_PATH, "bin", "install.mjs"),
  OPENSPEC_BIN: resolve(REPO_ROOT_PATH, "node_modules", ".bin", "openspec"),

  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_ERROR: 1,
  EXIT_CODE_FATAL: 2,
  EXIT_CODE_TIMEOUT: 124,

  DEFAULT_SUBPROCESS_TIMEOUT_MS: 10_000,
  SHORT_SUBPROCESS_TIMEOUT_MS: 2_500,
  POLL_INTERVAL_MS: 25,
  TEST_TIMEOUT_MS: 15_000,
  SLOW_TEST_TIMEOUT_MS: 30_000,

  TEMP_PREFIX_REPO: "cascade-e2e-repo-",
  TEMP_PREFIX_HOME: "cascade-e2e-home-",
  TEMP_PREFIX_LOGS: "cascade-e2e-logs-",
  TEMP_PREFIX_SANDBOX: "cascade-e2e-sandbox-",

  DEFAULT_BRANCH: "feat/e2e-test",
  PROTECTED_BRANCHES: ["main", "master", "stable"] as const,
  DEFAULT_GIT_USER_NAME: "Cascade E2E",
  DEFAULT_GIT_USER_EMAIL: "e2e@openspec-cascade.local",
  INITIAL_COMMIT_MESSAGE: "chore: initial e2e fixture",

  DEFAULT_SYSTEM_PATH: "/usr/local/bin:/usr/bin:/bin",
  TIMEOUT_SIGNAL: "SIGKILL" as const,

  DEFAULT_REVIEW_ELAPSED_SECONDS: 15,
  STALE_REVIEW_ELAPSED_SECONDS: 2,
  JSON_INDENT_SPACES: 2,
} as const;
