import { describe, expect, it } from "bun:test";
import {
  JULES_ADAPTER_CONSTANTS,
  JULES_AWAITING_INPUT_POLICIES,
  JULES_BATCH_OUTCOMES,
  JULES_SESSION_STATES,
  JulesAdapter,
  JulesAuthError,
  JulesAwaitingInputError,
  JulesCliNotFoundError,
  JulesSessionFailedError,
  JulesTimeoutError,
  buildJulesPrompt,
  formatJulesPrompt,
  normalizeJulesStatus,
  parseJulesCreatedSessionIds,
  parseJulesPullOutput,
  parseJulesSessionList,
  validateJulesParallel,
  type JulesAdapterOptions,
  type JulesSpawnedProcess,
  type JulesSubprocessSpawnFn,
} from "../../src/pal/adapters/jules";
import {
  PAL_CONTENT_BLOCK_TYPES,
  PAL_ERROR_KINDS,
  PAL_FINISH_REASONS,
  PAL_PROVIDER_NAMES,
  PAL_ROLES,
  PalError,
  createPalMessage,
  createTextBlock,
  type PalSessionOptions,
  type PalStreamEvent,
  type ProviderAdapter,
} from "../../src/pal/types";

const TEST_POLL_INTERVAL_MS = 1_000;
const TEST_POLL_TIMEOUT_MS = 10_000;
const TEST_COMMAND_TIMEOUT_MS = 50;
const TEST_REPO = "octo/example";
const SESSION_ID_A = "1234567890123456789";
const SESSION_ID_B = "9876543210987654321";
const FAKE_BIN = "jules";
const UNICODE_TEXT = "diff ñandú ✓";
const SESSION_ID_REAL = "17193127165342246332";
const NO_DIFF_OUTPUT = `${JULES_ADAPTER_CONSTANTS.NO_DIFF_MESSAGE}\n`;
/**
 * Verbatim session row captured from `jules remote list --session` while the session
 * was waiting for input: the Status column is empty, so the row has four columns.
 */
const REAL_AWAITING_INPUT_ROW =
  `${SESSION_ID_REAL}    Read-only validation task: reply with a one-line summary of…  ` +
  `sastiam/openspec-casc…  4m25s ago${" ".repeat(30)}`;

interface FakeCliResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  hangs?: boolean;
  spawnError?: Error;
}

type FakeCliHandler = (args: string[]) => FakeCliResponse;

/**
 * Emits text as byte chunks split inside a multi-byte character to exercise decoding.
 */
async function* byteChunks(text: string): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const mid = Math.floor(bytes.length / 2);
  yield bytes.slice(0, mid);
  yield bytes.slice(mid);
}

/**
 * Builds a mocked Jules CLI subprocess factory. Every call is recorded as its argv.
 */
function createFakeCli(handler: FakeCliHandler) {
  const calls: string[][] = [];
  const killSignals: string[] = [];

  const spawnFn: JulesSubprocessSpawnFn = (argv) => {
    calls.push([...argv]);
    const response = handler(argv.slice(2));
    if (response.spawnError) {
      throw response.spawnError;
    }
    const proc: JulesSpawnedProcess = {
      stdout: byteChunks(response.stdout ?? ""),
      stderr: byteChunks(response.stderr ?? ""),
      exited: response.hangs
        ? new Promise<number>(() => {})
        : Promise.resolve(response.exitCode ?? 0),
      kill: (signal?: number | string) => {
        killSignals.push(String(signal));
      },
    };
    return proc;
  };

  return { spawnFn, calls, killSignals };
}

/**
 * Deterministic clock: sleep advances time instead of waiting.
 */
function createFakeClock() {
  let current = 0;
  const sleepCalls: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
      current += ms;
    },
    sleepCalls,
  };
}

/**
 * Renders a session row in the same column layout as `jules remote list --session`.
 */
function sessionRow(id: string, description: string, status: string): string {
  return `  ${id}    ${description}    sastiam/example-repo    2 days ago    ${status}`;
}

const SESSION_LIST_HEADER =
  "           ID                 Description                    Repo              Last active        Status";

/**
 * Builds a `remote list` table from rows.
 */
function sessionListOutput(rows: string[]): string {
  return [SESSION_LIST_HEADER, ...rows].join("\n") + "\n";
}

/**
 * Creates an adapter wired to a fake CLI and a fake clock.
 */
function createAdapter(
  handler: FakeCliHandler,
  overrides: Partial<JulesAdapterOptions> = {}
) {
  const cli = createFakeCli(handler);
  const clock = createFakeClock();
  const adapter = new JulesAdapter({
    cliBin: FAKE_BIN,
    repo: TEST_REPO,
    pollIntervalMs: TEST_POLL_INTERVAL_MS,
    pollTimeoutMs: TEST_POLL_TIMEOUT_MS,
    commandTimeoutMs: TEST_COMMAND_TIMEOUT_MS,
    spawnFn: cli.spawnFn,
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  });
  return { adapter, cli, clock };
}

/**
 * Builds a handler that answers `new`, `list` (queued responses, last one repeats) and `pull`.
 */
function scriptedCli(options: {
  newStdout?: string;
  listStdouts: string[];
  pullStdouts?: Record<string, string>;
}): FakeCliHandler {
  let listIndex = 0;
  return (args) => {
    const action = args[0];
    if (action === "new") {
      return { stdout: options.newStdout ?? `Created session ${SESSION_ID_A}\n` };
    }
    if (action === "list") {
      const stdout =
        options.listStdouts[Math.min(listIndex, options.listStdouts.length - 1)] ??
        sessionListOutput([]);
      listIndex += 1;
      return { stdout };
    }
    if (action === "pull") {
      const idArg = args.find((arg) => arg.startsWith("--session="));
      const id = idArg?.slice("--session=".length) ?? "";
      return { stdout: options.pullStdouts?.[id] ?? "" };
    }
    return { exitCode: 2, stderr: `unknown action ${String(action)}` };
  };
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
}

function userSession(prompt: string): PalSessionOptions {
  return {
    sessionId: "pal-session-1",
    messages: [
      createPalMessage({
        role: PAL_ROLES.USER,
        content: [createTextBlock(prompt)],
      }),
    ],
  };
}

describe("Google Jules Provider Adapter (LOOPER-PAL-JULES)", () => {
  describe("ProviderAdapter conformance & capabilities", () => {
    it("initializes with defaults and satisfies ProviderAdapter", () => {
      const adapter = new JulesAdapter();
      const providerAdapter: ProviderAdapter = adapter;

      expect(providerAdapter.providerName).toBe(PAL_PROVIDER_NAMES.JULES);
      expect(adapter.modelName).toBe(JULES_ADAPTER_CONSTANTS.DEFAULT_MODEL);
    });

    it("reports non-streaming capabilities and no published quota", () => {
      const { adapter } = createAdapter(() => ({}));
      const capabilities = adapter.getCapabilities();

      expect(capabilities.providerName).toBe(PAL_PROVIDER_NAMES.JULES);
      expect(capabilities.supportsStreaming).toBe(false);
      expect(capabilities.supportsNativeTools).toBe(false);
      expect(capabilities.supportsPromptCaching).toBe(false);

      const rateLimit = adapter.getRateLimitState();
      expect(rateLimit.requestsRemaining).toBe(JULES_ADAPTER_CONSTANTS.NOT_REPORTED);
    });

    it("rejects parallelism outside the CLI bounds at construction", () => {
      expect(() => new JulesAdapter({ parallel: 0 })).toThrow(PalError);
      expect(() => new JulesAdapter({ parallel: 6 })).toThrow(PalError);
      expect(() => validateJulesParallel(2.5)).toThrow(PalError);
      expect(() => validateJulesParallel(JULES_ADAPTER_CONSTANTS.MAX_PARALLEL)).not.toThrow();
    });
  });

  describe("Remote session delegation (remote new)", () => {
    it("runs `remote new` with repo and prompt as single argv elements and no --parallel by default", async () => {
      const { adapter, cli } = createAdapter(scriptedCli({ listStdouts: [] }));

      const ids = await adapter.createSessions({ prompt: "add tests" });

      expect(cli.calls).toEqual([
        [
          FAKE_BIN,
          "remote",
          "new",
          `--repo=${TEST_REPO}`,
          "--session=add tests",
        ],
      ]);
      expect(ids).toEqual([SESSION_ID_A]);
    });

    it("keeps a prompt beginning with a dash as one argument", async () => {
      const { adapter, cli } = createAdapter(scriptedCli({ listStdouts: [] }));

      await adapter.createSessions({ prompt: "--force refactor" });

      expect(cli.calls[0]).toContain("--session=--force refactor");
    });

    it("passes --parallel <n> and returns every created session ID", async () => {
      const { adapter, cli } = createAdapter(
        scriptedCli({
          listStdouts: [],
          newStdout: `Created 3 sessions:\n${SESSION_ID_A}\n${SESSION_ID_B}\n1111111111111111111\n`,
        })
      );

      const ids = await adapter.createSessions({ prompt: "fix lint", parallel: 3 });

      expect(cli.calls[0]).toContain("--parallel");
      expect(cli.calls[0]?.[cli.calls[0].indexOf("--parallel") + 1]).toBe("3");
      expect(ids).toEqual([SESSION_ID_A, SESSION_ID_B, "1111111111111111111"]);
    });

    it("omits --repo when no repository is configured so the CLI uses the working directory", async () => {
      const cli = createFakeCli(scriptedCli({ listStdouts: [] }));
      const adapter = new JulesAdapter({ spawnFn: cli.spawnFn, cliBin: FAKE_BIN });

      await adapter.createSessions({ prompt: "task" });

      expect(cli.calls[0]?.some((arg) => arg.startsWith("--repo"))).toBe(false);
    });

    it("rejects a per-task parallelism above the CLI maximum without spawning", async () => {
      const { adapter, cli } = createAdapter(scriptedCli({ listStdouts: [] }));

      await expect(
        adapter.createSessions({ prompt: "task", parallel: JULES_ADAPTER_CONSTANTS.MAX_PARALLEL + 1 })
      ).rejects.toBeInstanceOf(PalError);
      expect(cli.calls).toHaveLength(0);
    });

    it("raises INVALID_REQUEST when no session ID can be extracted", async () => {
      const { adapter } = createAdapter(scriptedCli({ listStdouts: [], newStdout: "ok\n" }));

      const error = await adapter.createSessions({ prompt: "task" }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PalError);
      expect((error as PalError).kind).toBe(PAL_ERROR_KINDS.INVALID_REQUEST);
    });
  });

  describe("Stdout parsing (isolated)", () => {
    it("parses the observed session table, including descriptions containing spaces", () => {
      const stdout = sessionListOutput([
        sessionRow(SESSION_ID_A, "# ROLE: Curador de contenido (Repo: vault…", "Completed"),
        sessionRow(SESSION_ID_B, "Actúa como  un lead   product manager", "In Progress"),
      ]);

      const rows = parseJulesSessionList(stdout);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: SESSION_ID_A,
        repo: "sastiam/example-repo",
        lastActive: "2 days ago",
        status: "Completed",
      });
      expect(rows[1]?.status).toBe("In Progress");
      expect(rows[1]?.description).toBe("Actúa como un lead product manager");
    });

    it("strips ANSI escape codes before parsing", () => {
      const stdout = `\u001b[1m${SESSION_LIST_HEADER}\u001b[0m\n${sessionRow(SESSION_ID_A, "task", "\u001b[32mCompleted\u001b[0m")}\n`;

      const rows = parseJulesSessionList(stdout);

      expect(rows.map((row) => row.status)).toEqual(["Completed"]);
    });

    it("returns no rows for empty output", () => {
      expect(parseJulesSessionList("")).toEqual([]);
    });

    it("extracts unique numeric session IDs from creation output", () => {
      const ids = parseJulesCreatedSessionIds(
        `Session ${SESSION_ID_A} created\nSession ${SESSION_ID_A} created\nID ${SESSION_ID_B}\n`
      );

      expect(ids).toEqual([SESSION_ID_A, SESSION_ID_B]);
    });

    it("normalizes raw status labels", () => {
      expect(normalizeJulesStatus("Completed")).toBe(JULES_SESSION_STATES.COMPLETED);
      expect(normalizeJulesStatus("In Progress")).toBe(JULES_SESSION_STATES.RUNNING);
      expect(normalizeJulesStatus("Failed")).toBe(JULES_SESSION_STATES.FAILED);
      expect(normalizeJulesStatus("cancelled")).toBe(JULES_SESSION_STATES.FAILED);
      expect(normalizeJulesStatus("Awaiting Plan Approval")).toBe(JULES_SESSION_STATES.RUNNING);
    });

    it("parses the real awaiting-input row: empty status, last active not taken as status", () => {
      const rows = parseJulesSessionList(sessionListOutput([REAL_AWAITING_INPUT_ROW]));

      expect(rows).toEqual([
        {
          id: SESSION_ID_REAL,
          description: "Read-only validation task: reply with a one-line summary of…",
          repo: "sastiam/openspec-casc…",
          lastActive: "4m25s ago",
          status: "",
        },
      ]);
    });

    it("parses a mixed table where one row has a status and one has an empty status", () => {
      const rows = parseJulesSessionList(
        sessionListOutput([
          sessionRow(SESSION_ID_A, "task", "In Progress"),
          REAL_AWAITING_INPUT_ROW,
        ])
      );

      expect(rows.map((row) => [row.id, row.status, row.lastActive])).toEqual([
        [SESSION_ID_A, "In Progress", "2 days ago"],
        [SESSION_ID_REAL, "", "4m25s ago"],
      ]);
    });

    it("maps an empty status to AwaitingInput, including whitespace-only labels", () => {
      expect(normalizeJulesStatus("")).toBe(JULES_SESSION_STATES.AWAITING_INPUT);
      expect(normalizeJulesStatus("   ")).toBe(JULES_SESSION_STATES.AWAITING_INPUT);
    });
  });

  describe("Empty pull result (no changes on the remote VM)", () => {
    it("classifies the 'No diff found' output as an empty result", async () => {
      const { adapter } = createAdapter(
        scriptedCli({ listStdouts: [], pullStdouts: { [SESSION_ID_A]: NO_DIFF_OUTPUT } })
      );

      expect(await adapter.pullSession(SESSION_ID_A)).toEqual({ status: "empty" });
    });

    it("treats blank pull output as an empty result", () => {
      expect(parseJulesPullOutput("")).toEqual({ status: "empty" });
      expect(parseJulesPullOutput("  \n")).toEqual({ status: "empty" });
    });

    it("does not treat a diff that merely contains the 'No diff' text as empty", () => {
      const stdout = `${JULES_ADAPTER_CONSTANTS.NO_DIFF_MESSAGE}\n+added line\n`;

      expect(parseJulesPullOutput(stdout)).toEqual({ status: "diff", patch: stdout });
    });
  });

  describe("Result retrieval (remote pull)", () => {
    it("runs `remote pull --session <id>` without --apply and returns the patch", async () => {
      const patch = `diff --git a/x b/x\n+${UNICODE_TEXT}\n`;
      const { adapter, cli } = createAdapter(
        scriptedCli({ listStdouts: [], pullStdouts: { [SESSION_ID_A]: patch } })
      );

      const result = await adapter.pullSession(SESSION_ID_A);

      expect(cli.calls[0]).toEqual([FAKE_BIN, "remote", "pull", `--session=${SESSION_ID_A}`]);
      expect(cli.calls[0]).not.toContain("--apply");
      expect(result).toEqual({ status: "diff", patch });
    });
  });

  describe("Awaiting-input policy", () => {
    it("fails fast by default after the poll limit, without waiting for the timeout", async () => {
      const { adapter, cli, clock } = createAdapter(
        scriptedCli({ listStdouts: [sessionListOutput([REAL_AWAITING_INPUT_ROW])] })
      );

      const error = await collect(adapter.watchSessions([SESSION_ID_REAL])).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesAwaitingInputError);
      expect(error).not.toBeInstanceOf(JulesTimeoutError);
      expect((error as PalError).kind).toBe(PAL_ERROR_KINDS.TOOL_ERROR);
      expect((error as PalError).retryable).toBe(false);
      expect((error as PalError).message).toContain(
        `https://jules.google.com/session/${SESSION_ID_REAL}`
      );
      expect((error as PalError).message).toContain("needs user input");
      expect(cli.calls.filter((argv) => argv[2] === "list")).toHaveLength(
        JULES_ADAPTER_CONSTANTS.DEFAULT_AWAITING_INPUT_POLL_LIMIT
      );
      expect(clock.sleepCalls).toHaveLength(
        JULES_ADAPTER_CONSTANTS.DEFAULT_AWAITING_INPUT_POLL_LIMIT - 1
      );
    });

    it("applies a configured consecutive-poll limit", async () => {
      const { adapter, cli } = createAdapter(
        scriptedCli({ listStdouts: [sessionListOutput([REAL_AWAITING_INPUT_ROW])] }),
        { awaitingInputPollLimit: 5 }
      );

      const error = await collect(adapter.watchSessions([SESSION_ID_REAL])).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesAwaitingInputError);
      expect((error as JulesAwaitingInputError).consecutivePolls).toBe(5);
      expect(cli.calls.filter((argv) => argv[2] === "list")).toHaveLength(5);
    });

    it("resets the consecutive count when the session leaves AwaitingInput", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          listStdouts: [
            sessionListOutput([REAL_AWAITING_INPUT_ROW]),
            sessionListOutput([REAL_AWAITING_INPUT_ROW]),
            sessionListOutput([sessionRow(SESSION_ID_REAL, "task", "In Progress")]),
            sessionListOutput([REAL_AWAITING_INPUT_ROW]),
            sessionListOutput([REAL_AWAITING_INPUT_ROW]),
            sessionListOutput([sessionRow(SESSION_ID_REAL, "task", "Completed")]),
          ],
        }),
        { awaitingInputPollLimit: 3 }
      );

      const transitions = await collect(adapter.watchSessions([SESSION_ID_REAL]));

      expect(transitions.map((t) => t.state)).toEqual([
        JULES_SESSION_STATES.AWAITING_INPUT,
        JULES_SESSION_STATES.RUNNING,
        JULES_SESSION_STATES.AWAITING_INPUT,
        JULES_SESSION_STATES.COMPLETED,
      ]);
    });

    it("keep-waiting policy polls until the timeout instead of failing", async () => {
      const { adapter, clock } = createAdapter(
        scriptedCli({ listStdouts: [sessionListOutput([REAL_AWAITING_INPUT_ROW])] }),
        { awaitingInputPolicy: JULES_AWAITING_INPUT_POLICIES.KEEP_WAITING }
      );

      const error = await collect(adapter.watchSessions([SESSION_ID_REAL])).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesTimeoutError);
      expect((error as JulesTimeoutError).pendingSessionIds).toEqual([SESSION_ID_REAL]);
      expect(clock.sleepCalls.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(
        TEST_POLL_TIMEOUT_MS
      );
    });

    it("rejects an unknown policy or a non-positive poll limit at construction", () => {
      expect(
        () => new JulesAdapter({ awaitingInputPolicy: "bogus" as never })
      ).toThrow(PalError);
      expect(() => new JulesAdapter({ awaitingInputPollLimit: 0 })).toThrow(PalError);
      expect(() => new JulesAdapter({ awaitingInputPollLimit: 1.5 })).toThrow(PalError);
      expect(() => new JulesAdapter({ awaitingInputPollLimit: 1 })).not.toThrow();
    });

    it("streamTurn yields the awaiting-input error as a single error event after a status thought", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          newStdout: `Created session ${SESSION_ID_REAL}\n`,
          listStdouts: [sessionListOutput([REAL_AWAITING_INPUT_ROW])],
        })
      );

      const events = await collect<PalStreamEvent>(adapter.streamTurn(userSession("task")));

      expect(events[0]).toEqual({
        type: "thought_delta",
        thought: `Jules session ${SESSION_ID_REAL}: ${JULES_ADAPTER_CONSTANTS.EMPTY_STATUS_DISPLAY_LABEL}`,
      });
      expect(events.at(-1)?.type).toBe("error");
      const last = events.at(-1);
      if (last?.type === "error") {
        expect(last.error).toBeInstanceOf(JulesAwaitingInputError);
      }
    });
  });

  describe("Finished session with empty status", () => {
    const FINISHED_PATCH = `diff --git a/x b/x\n+finished work\n`;

    it("completes an awaiting session whose pull returns a diff, without error", async () => {
      const patches = new Map<string, string>();
      const { adapter, cli } = createAdapter(
        scriptedCli({
          listStdouts: [sessionListOutput([REAL_AWAITING_INPUT_ROW])],
          pullStdouts: { [SESSION_ID_REAL]: FINISHED_PATCH },
        })
      );

      const transitions = await collect(
        adapter.watchSessions([SESSION_ID_REAL], undefined, patches)
      );

      expect(transitions).toEqual([
        { sessionId: SESSION_ID_REAL, rawStatus: "", state: JULES_SESSION_STATES.COMPLETED },
      ]);
      expect(patches.get(SESSION_ID_REAL)).toBe(FINISHED_PATCH);
      expect(cli.calls.filter((argv) => argv[2] === "pull")).toHaveLength(1);
    });

    it("completes a session that becomes ready after an empty poll, pulling once per poll", async () => {
      let pullCount = 0;
      const { adapter, cli } = createAdapter((args) => {
        if (args[0] === "list") {
          return { stdout: sessionListOutput([REAL_AWAITING_INPUT_ROW]) };
        }
        pullCount += 1;
        return { stdout: pullCount === 1 ? NO_DIFF_OUTPUT : FINISHED_PATCH };
      });

      const transitions = await collect(adapter.watchSessions([SESSION_ID_REAL]));

      expect(transitions.map((t) => t.state)).toEqual([
        JULES_SESSION_STATES.AWAITING_INPUT,
        JULES_SESSION_STATES.COMPLETED,
      ]);
      expect(cli.calls.filter((argv) => argv[2] === "pull")).toHaveLength(2);
    });

    it("still fails an awaiting session whose pull stays empty, after the poll limit", async () => {
      const { adapter, cli } = createAdapter(
        scriptedCli({
          listStdouts: [sessionListOutput([REAL_AWAITING_INPUT_ROW])],
          pullStdouts: {},
        })
      );

      const error = await collect(adapter.watchSessions([SESSION_ID_REAL])).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesAwaitingInputError);
      const limit = JULES_ADAPTER_CONSTANTS.DEFAULT_AWAITING_INPUT_POLL_LIMIT;
      expect(cli.calls.filter((argv) => argv[2] === "list")).toHaveLength(limit);
      expect(cli.calls.filter((argv) => argv[2] === "pull")).toHaveLength(limit);
    });

    it("treats a failed pull as not ready instead of crashing the watch", async () => {
      const { adapter } = createAdapter((args) =>
        args[0] === "list"
          ? { stdout: sessionListOutput([REAL_AWAITING_INPUT_ROW]) }
          : { exitCode: 3, stderr: "pull failed" }
      );

      const error = await collect(adapter.watchSessions([SESSION_ID_REAL])).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesAwaitingInputError);
    });

    it("keep-waiting policy still completes an awaiting session once its pull returns a diff", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          listStdouts: [sessionListOutput([REAL_AWAITING_INPUT_ROW])],
          pullStdouts: { [SESSION_ID_REAL]: FINISHED_PATCH },
        }),
        { awaitingInputPolicy: JULES_AWAITING_INPUT_POLICIES.KEEP_WAITING }
      );

      const transitions = await collect(adapter.watchSessions([SESSION_ID_REAL]));

      expect(transitions.map((t) => t.state)).toEqual([JULES_SESSION_STATES.COMPLETED]);
    });

    it("streamTurn reuses the diff pulled while watching instead of pulling again", async () => {
      const { adapter, cli } = createAdapter(
        scriptedCli({
          newStdout: `Created session ${SESSION_ID_REAL}\n`,
          listStdouts: [sessionListOutput([REAL_AWAITING_INPUT_ROW])],
          pullStdouts: { [SESSION_ID_REAL]: FINISHED_PATCH },
        })
      );

      const events = await collect<PalStreamEvent>(adapter.streamTurn(userSession("task")));

      expect(events).toEqual([
        {
          type: "thought_delta",
          thought: `Jules session ${SESSION_ID_REAL}: ${JULES_ADAPTER_CONSTANTS.PULL_COMPLETED_DISPLAY_LABEL}`,
        },
        { type: "text_delta", text: FINISHED_PATCH },
        {
          type: "turn_complete",
          finishReason: PAL_FINISH_REASONS.STOP,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      ]);
      expect(cli.calls.filter((argv) => argv[2] === "pull")).toHaveLength(1);
    });
  });

  describe("Polling & lifecycle normalization", () => {
    it("emits one transition per state change and stops once every session completes", async () => {
      const { adapter, clock } = createAdapter(
        scriptedCli({
          listStdouts: [
            sessionListOutput([sessionRow(SESSION_ID_A, "task", "In Progress")]),
            sessionListOutput([sessionRow(SESSION_ID_A, "task", "In Progress")]),
            sessionListOutput([sessionRow(SESSION_ID_A, "task", "Completed")]),
          ],
        })
      );

      const transitions = await collect(adapter.watchSessions([SESSION_ID_A]));

      expect(transitions).toEqual([
        { sessionId: SESSION_ID_A, rawStatus: "In Progress", state: JULES_SESSION_STATES.RUNNING },
        { sessionId: SESSION_ID_A, rawStatus: "Completed", state: JULES_SESSION_STATES.COMPLETED },
      ]);
      expect(clock.sleepCalls).toEqual([TEST_POLL_INTERVAL_MS, TEST_POLL_INTERVAL_MS]);
    });

    it("throws JulesSessionFailedError when a tracked session fails", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          listStdouts: [sessionListOutput([sessionRow(SESSION_ID_A, "task", "Failed")])],
        })
      );

      const error = await collect(adapter.watchSessions([SESSION_ID_A])).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesSessionFailedError);
      expect((error as JulesSessionFailedError).sessionId).toBe(SESSION_ID_A);
      expect((error as JulesSessionFailedError).kind).toBe(PAL_ERROR_KINDS.TOOL_ERROR);
    });

    it("throws JulesTimeoutError listing pending sessions once the poll deadline passes", async () => {
      const { adapter, clock } = createAdapter(
        scriptedCli({
          listStdouts: [sessionListOutput([sessionRow(SESSION_ID_A, "task", "In Progress")])],
        })
      );

      const error = await collect(adapter.watchSessions([SESSION_ID_A])).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesTimeoutError);
      expect((error as JulesTimeoutError).pendingSessionIds).toEqual([SESSION_ID_A]);
      expect((error as JulesTimeoutError).retryable).toBe(true);
      expect(clock.sleepCalls.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(
        TEST_POLL_TIMEOUT_MS
      );
    });

    it("keeps waiting for a session that has not yet appeared in the list", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          listStdouts: [
            sessionListOutput([]),
            sessionListOutput([sessionRow(SESSION_ID_A, "task", "Completed")]),
          ],
        })
      );

      const transitions = await collect(adapter.watchSessions([SESSION_ID_A]));

      expect(transitions.map((t) => t.state)).toEqual([JULES_SESSION_STATES.COMPLETED]);
    });
  });

  describe("Typed environment and CLI errors", () => {
    it("raises JulesCliNotFoundError with install hint when the binary is missing", async () => {
      const missing = Object.assign(new Error('Executable not found in $PATH: "jules"'), {
        code: "ENOENT",
      });
      const { adapter } = createAdapter(() => ({ spawnError: missing }));

      const error = await adapter.createSessions({ prompt: "task" }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesCliNotFoundError);
      expect(error).toBeInstanceOf(PalError);
      expect((error as PalError).message).toContain("npm install -g @google/jules");
      expect((error as PalError).kind).toBe(PAL_ERROR_KINDS.INVALID_REQUEST);
    });

    it("raises JulesAuthError when the CLI reports no logged-in account", async () => {
      const { adapter } = createAdapter(() => ({
        exitCode: 1,
        stderr: "Error: not logged in. Run jules login to continue.\n",
      }));

      const error = await adapter.listSessions().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JulesAuthError);
      expect((error as PalError).kind).toBe(PAL_ERROR_KINDS.AUTH_FAILURE);
      expect((error as PalError).retryable).toBe(false);
    });

    it("maps other non-zero exits to a non-retryable TOOL_ERROR carrying stderr", async () => {
      const { adapter } = createAdapter(() => ({ exitCode: 3, stderr: "repo not connected" }));

      const error = await adapter.pullSession(SESSION_ID_A).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PalError);
      expect((error as PalError).kind).toBe(PAL_ERROR_KINDS.TOOL_ERROR);
      expect((error as PalError).message).toContain("repo not connected");
    });

    it("times out and kills a CLI command that never exits", async () => {
      const { adapter, cli } = createAdapter(() => ({ hangs: true }));

      const error = await adapter.listSessions().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PalError);
      expect((error as PalError).kind).toBe(PAL_ERROR_KINDS.TIMEOUT);
      expect(cli.killSignals).toEqual(["SIGTERM"]);
    });
  });

  describe("Canonical turn execution", () => {
    it("executeTurn delegates, polls, pulls and returns the patch as the assistant message", async () => {
      const patch = `diff --git a/a.ts b/a.ts\n+const x = "${UNICODE_TEXT}";\n`;
      const { adapter, cli } = createAdapter(
        scriptedCli({
          newStdout: `Session ${SESSION_ID_A} created\n`,
          listStdouts: [
            sessionListOutput([sessionRow(SESSION_ID_A, "task", "In Progress")]),
            sessionListOutput([sessionRow(SESSION_ID_A, "task", "Completed")]),
          ],
          pullStdouts: { [SESSION_ID_A]: patch },
        })
      );

      const outcome = await adapter.executeTurn(userSession("Refactor the parser"));

      expect(cli.calls.map((argv) => argv[2])).toEqual(["new", "list", "list", "pull"]);
      expect(cli.calls[0]?.[4]).toContain("Refactor the parser");
      expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.STOP);
      expect(outcome.message.role).toBe(PAL_ROLES.ASSISTANT);
      const block = outcome.message.content[0];
      expect(block?.type).toBe(PAL_CONTENT_BLOCK_TYPES.TEXT);
      expect(block && "text" in block ? block.text : "").toBe(patch);
      expect(outcome.usage.totalTokens).toBe(JULES_ADAPTER_CONSTANTS.ZERO_TOKENS);
    });

    it("streamTurn emits thought_delta per transition, text_delta per result and a final turn_complete", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          listStdouts: [
            sessionListOutput([sessionRow(SESSION_ID_A, "task", "In Progress")]),
            sessionListOutput([sessionRow(SESSION_ID_A, "task", "Completed")]),
          ],
          pullStdouts: { [SESSION_ID_A]: "patch-body" },
        })
      );

      const events = await collect<PalStreamEvent>(adapter.streamTurn(userSession("task")));

      expect(events.map((e) => e.type)).toEqual([
        "thought_delta",
        "thought_delta",
        "text_delta",
        "turn_complete",
      ]);
      expect(events[2]).toEqual({ type: "text_delta", text: "patch-body" });
    });

    it("runs parallel sessions and tags each result with its session ID", async () => {
      const cli = createFakeCli(
        scriptedCli({
          newStdout: `${SESSION_ID_A}\n${SESSION_ID_B}\n`,
          listStdouts: [
            sessionListOutput([
              sessionRow(SESSION_ID_A, "task", "Completed"),
              sessionRow(SESSION_ID_B, "task", "Completed"),
            ]),
          ],
          pullStdouts: { [SESSION_ID_A]: "patch-A", [SESSION_ID_B]: "patch-B" },
        })
      );
      const parallelAdapter = new JulesAdapter({
        cliBin: FAKE_BIN,
        repo: TEST_REPO,
        parallel: 2,
        pollIntervalMs: TEST_POLL_INTERVAL_MS,
        pollTimeoutMs: TEST_POLL_TIMEOUT_MS,
        commandTimeoutMs: TEST_COMMAND_TIMEOUT_MS,
        spawnFn: cli.spawnFn,
      });

      const outcome = await parallelAdapter.executeTurn(userSession("task"));

      expect(cli.calls[0]).toContain("--parallel");
      const text = outcome.message.content
        .map((block) => (block.type === PAL_CONTENT_BLOCK_TYPES.TEXT ? block.text : ""))
        .join("");
      expect(text).toContain(`${JULES_ADAPTER_CONSTANTS.SESSION_SECTION_HEADING} ${SESSION_ID_A}`);
      expect(text).toContain("patch-A");
      expect(text).toContain(`${JULES_ADAPTER_CONSTANTS.SESSION_SECTION_HEADING} ${SESSION_ID_B}`);
      expect(text).toContain("patch-B");
    });

    it("streamTurn yields a single error event instead of throwing when a session fails", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          listStdouts: [sessionListOutput([sessionRow(SESSION_ID_A, "task", "Failed")])],
        })
      );

      const events = await collect<PalStreamEvent>(adapter.streamTurn(userSession("task")));

      const errors = events.filter((e) => e.type === "error");
      expect(errors).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("error");
      const [onlyError] = errors;
      if (onlyError?.type === "error") {
        expect(onlyError.error).toBeInstanceOf(JulesSessionFailedError);
      }
    });

    it("streamTurn reports a no-changes session as a thought with no text_delta", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          listStdouts: [sessionListOutput([sessionRow(SESSION_ID_A, "task", "Completed")])],
          pullStdouts: { [SESSION_ID_A]: NO_DIFF_OUTPUT },
        })
      );

      const events = await collect<PalStreamEvent>(adapter.streamTurn(userSession("task")));

      expect(events.map((e) => e.type)).toEqual(["thought_delta", "thought_delta", "turn_complete"]);
      expect(events[1]).toEqual({
        type: "thought_delta",
        thought: `Jules session ${SESSION_ID_A}: completed with no changes to pull`,
      });
    });

    it("executeTurn completes with an empty assistant message when there are no changes", async () => {
      const { adapter } = createAdapter(
        scriptedCli({
          listStdouts: [sessionListOutput([sessionRow(SESSION_ID_A, "task", "Completed")])],
          pullStdouts: { [SESSION_ID_A]: NO_DIFF_OUTPUT },
        })
      );

      const outcome = await adapter.executeTurn(userSession("task"));

      expect(outcome.finishReason).toBe(PAL_FINISH_REASONS.STOP);
      expect(outcome.message.content.map((b) => (b.type === PAL_CONTENT_BLOCK_TYPES.TEXT ? b.text : "")).join("")).toBe("");
    });

    it("parallel run tags only the sessions that produced a diff", async () => {
      const cli = createFakeCli(
        scriptedCli({
          newStdout: `${SESSION_ID_A}\n${SESSION_ID_B}\n`,
          listStdouts: [
            sessionListOutput([
              sessionRow(SESSION_ID_A, "task", "Completed"),
              sessionRow(SESSION_ID_B, "task", "Completed"),
            ]),
          ],
          pullStdouts: { [SESSION_ID_A]: "patch-A", [SESSION_ID_B]: NO_DIFF_OUTPUT },
        })
      );
      const parallelAdapter = new JulesAdapter({
        cliBin: FAKE_BIN,
        repo: TEST_REPO,
        parallel: 2,
        pollIntervalMs: TEST_POLL_INTERVAL_MS,
        pollTimeoutMs: TEST_POLL_TIMEOUT_MS,
        commandTimeoutMs: TEST_COMMAND_TIMEOUT_MS,
        spawnFn: cli.spawnFn,
      });

      const outcome = await parallelAdapter.executeTurn(userSession("task"));

      const text = outcome.message.content
        .map((block) => (block.type === PAL_CONTENT_BLOCK_TYPES.TEXT ? block.text : ""))
        .join("");
      expect(text).toContain(`${JULES_ADAPTER_CONSTANTS.SESSION_SECTION_HEADING} ${SESSION_ID_A}`);
      expect(text).toContain("patch-A");
      expect(text).not.toContain(SESSION_ID_B);
      expect(text).not.toContain(JULES_ADAPTER_CONSTANTS.NO_DIFF_MESSAGE);
    });

    it("executeTurn rethrows the typed error from a missing CLI", async () => {
      const missing = Object.assign(new Error("Executable not found"), { code: "ENOENT" });
      const { adapter } = createAdapter(() => ({ spawnError: missing }));

      await expect(adapter.executeTurn(userSession("task"))).rejects.toBeInstanceOf(
        JulesCliNotFoundError
      );
    });

    it("stops polling and yields an error when the caller aborts", async () => {
      const controller = new AbortController();
      controller.abort();
      const { adapter, cli } = createAdapter(scriptedCli({ listStdouts: [] }));

      const events = await collect<PalStreamEvent>(
        adapter.streamTurn({ ...userSession("task"), abortSignal: controller.signal })
      );

      expect(events.map((e) => e.type)).toEqual(["error"]);
      expect(cli.calls.map((argv) => argv[2])).toEqual(["new"]);
    });
  });

  describe("Batch execution (runBatch)", () => {
    const TASK_ONE = { id: "t1", prompt: "PROMPT-ONE" };
    const TASK_TWO = { id: "t2", prompt: "PROMPT-TWO" };
    const SESSION_FLAG_PREFIX = "--session=";

    interface BatchCliScript {
      sessionIdByPrompt: Record<string, string>;
      failCreatePrompts?: string[];
      statusOf: (sessionId: string, listCall: number) => string;
      pulls?: Record<string, string>;
      failPulls?: string[];
      failList?: boolean;
    }

    /**
     * Fake CLI for a batch: `new` maps the prompt to a session, `list` renders every created
     * session with its scripted status, `pull` answers from the script.
     */
    function batchCli(script: BatchCliScript): FakeCliHandler {
      const created: string[] = [];
      let listCalls = 0;
      return (args) => {
        const action = args[0];
        const sessionArg =
          args.find((arg) => arg.startsWith(SESSION_FLAG_PREFIX))?.slice(SESSION_FLAG_PREFIX.length) ??
          "";
        if (action === "new") {
          if (script.failCreatePrompts?.includes(sessionArg)) {
            return { exitCode: 1, stderr: "quota exceeded" };
          }
          const id = script.sessionIdByPrompt[sessionArg] ?? "";
          created.push(id);
          return { stdout: `Created session ${id}\n` };
        }
        if (action === "list") {
          listCalls += 1;
          if (script.failList) {
            return { exitCode: 3, stderr: "list failed" };
          }
          return {
            stdout: sessionListOutput(
              created.map((id) => sessionRow(id, "task", script.statusOf(id, listCalls)))
            ),
          };
        }
        if (action === "pull") {
          if (script.failPulls?.includes(sessionArg)) {
            return { exitCode: 3, stderr: "pull failed" };
          }
          return { stdout: script.pulls?.[sessionArg] ?? NO_DIFF_OUTPUT };
        }
        return { exitCode: 2, stderr: `unknown action ${String(action)}` };
      };
    }

    const SESSIONS_BY_PROMPT = {
      "PROMPT-ONE": SESSION_ID_A,
      "PROMPT-TWO": SESSION_ID_B,
    };

    function actionsOf(cli: { calls: string[][] }): string[] {
      return cli.calls.map((argv) => argv[2] ?? "");
    }

    it("creates one session per task with the repo and no --parallel, returning results in input order", async () => {
      const { adapter, cli } = createAdapter(
        batchCli({
          sessionIdByPrompt: SESSIONS_BY_PROMPT,
          statusOf: () => "Completed",
          pulls: { [SESSION_ID_A]: "patch-A", [SESSION_ID_B]: "patch-B" },
        })
      );

      const results = await adapter.runBatch([TASK_ONE, TASK_TWO]);

      expect(results).toEqual([
        { taskId: "t1", sessionId: SESSION_ID_A, outcome: JULES_BATCH_OUTCOMES.DIFF, patch: "patch-A" },
        { taskId: "t2", sessionId: SESSION_ID_B, outcome: JULES_BATCH_OUTCOMES.DIFF, patch: "patch-B" },
      ]);
      const newCalls = cli.calls.filter((argv) => argv[2] === "new");
      expect(newCalls).toHaveLength(2);
      for (const argv of newCalls) {
        expect(argv).toContain(`--repo=${TEST_REPO}`);
        expect(argv).not.toContain("--parallel");
      }
    });

    it("records a creation failure for one task without aborting the others", async () => {
      const { adapter } = createAdapter(
        batchCli({
          sessionIdByPrompt: SESSIONS_BY_PROMPT,
          failCreatePrompts: [TASK_ONE.prompt],
          statusOf: () => "Completed",
          pulls: { [SESSION_ID_B]: "patch-B" },
        })
      );

      const [first, second] = await adapter.runBatch([TASK_ONE, TASK_TWO]);

      expect(first?.outcome).toBe(JULES_BATCH_OUTCOMES.FAILED);
      expect(first?.sessionId).toBeUndefined();
      expect(first?.error).toContain("quota exceeded");
      expect(second).toEqual({
        taskId: "t2",
        sessionId: SESSION_ID_B,
        outcome: JULES_BATCH_OUTCOMES.DIFF,
        patch: "patch-B",
      });
    });

    it("records a failed session as failed while the other sessions complete", async () => {
      const { adapter } = createAdapter(
        batchCli({
          sessionIdByPrompt: SESSIONS_BY_PROMPT,
          statusOf: (id) => (id === SESSION_ID_A ? "Failed" : "Completed"),
          pulls: { [SESSION_ID_B]: "patch-B" },
        })
      );

      const [first, second] = await adapter.runBatch([TASK_ONE, TASK_TWO]);

      expect(first?.outcome).toBe(JULES_BATCH_OUTCOMES.FAILED);
      expect(first?.sessionId).toBe(SESSION_ID_A);
      expect(first?.error).toContain(`Jules session ${SESSION_ID_A} ended`);
      expect(second?.outcome).toBe(JULES_BATCH_OUTCOMES.DIFF);
    });

    it("classifies awaiting sessions by their pull: a diff is a result, an empty pull needs input", async () => {
      const { adapter } = createAdapter(
        batchCli({
          sessionIdByPrompt: SESSIONS_BY_PROMPT,
          statusOf: () => "",
          pulls: { [SESSION_ID_A]: "patch-A" },
        })
      );

      const [first, second] = await adapter.runBatch([TASK_ONE, TASK_TWO]);

      expect(first).toEqual({
        taskId: "t1",
        sessionId: SESSION_ID_A,
        outcome: JULES_BATCH_OUTCOMES.DIFF,
        patch: "patch-A",
      });
      expect(second?.outcome).toBe(JULES_BATCH_OUTCOMES.NEEDS_INPUT);
      expect(second?.error).toContain(`https://jules.google.com/session/${SESSION_ID_B}`);
    });

    it("keep-waiting policy times out an awaiting session with no diff instead of asking for input", async () => {
      const { adapter } = createAdapter(
        batchCli({
          sessionIdByPrompt: SESSIONS_BY_PROMPT,
          statusOf: () => "",
        }),
        { awaitingInputPolicy: JULES_AWAITING_INPUT_POLICIES.KEEP_WAITING }
      );

      const results = await adapter.runBatch([TASK_ONE]);

      expect(results[0]?.outcome).toBe(JULES_BATCH_OUTCOMES.TIMEOUT);
      expect(results[0]?.error).toContain("did not complete");
    });

    it("records a session still running at the deadline as timeout and keeps the finished diffs", async () => {
      const { adapter } = createAdapter(
        batchCli({
          sessionIdByPrompt: SESSIONS_BY_PROMPT,
          statusOf: (id) => (id === SESSION_ID_B ? "In Progress" : "Completed"),
          pulls: { [SESSION_ID_A]: "patch-A" },
        })
      );

      const [first, second] = await adapter.runBatch([TASK_ONE, TASK_TWO]);

      expect(first?.outcome).toBe(JULES_BATCH_OUTCOMES.DIFF);
      expect(second?.outcome).toBe(JULES_BATCH_OUTCOMES.TIMEOUT);
      expect(second?.sessionId).toBe(SESSION_ID_B);
    });

    it("records a failed pull of a finished session as failed for that task only", async () => {
      const { adapter } = createAdapter(
        batchCli({
          sessionIdByPrompt: SESSIONS_BY_PROMPT,
          statusOf: () => "Completed",
          failPulls: [SESSION_ID_A],
          pulls: { [SESSION_ID_B]: "patch-B" },
        })
      );

      const [first, second] = await adapter.runBatch([TASK_ONE, TASK_TWO]);

      expect(first?.outcome).toBe(JULES_BATCH_OUTCOMES.FAILED);
      expect(first?.error).toContain("pull failed");
      expect(second?.outcome).toBe(JULES_BATCH_OUTCOMES.DIFF);
    });

    it("reports an empty pull of a finished session as empty", async () => {
      const { adapter } = createAdapter(
        batchCli({ sessionIdByPrompt: SESSIONS_BY_PROMPT, statusOf: () => "Completed" })
      );

      const results = await adapter.runBatch([TASK_ONE]);

      expect(results).toEqual([
        { taskId: "t1", sessionId: SESSION_ID_A, outcome: JULES_BATCH_OUTCOMES.EMPTY },
      ]);
    });

    it("shares one remote list poll across every session in a wave", async () => {
      const { adapter, cli } = createAdapter(
        batchCli({
          sessionIdByPrompt: SESSIONS_BY_PROMPT,
          statusOf: () => "Completed",
          pulls: { [SESSION_ID_A]: "patch-A", [SESSION_ID_B]: "patch-B" },
        })
      );

      await adapter.runBatch([TASK_ONE, TASK_TWO]);

      expect(cli.calls.filter((argv) => argv[2] === "list")).toHaveLength(1);
    });

    it("runs sessions in waves of maxConcurrent, finishing a wave before creating the next", async () => {
      const tasks = ["a", "b", "c", "d", "e"].map((id) => ({ id, prompt: `prompt-${id}` }));
      const sessionIdByPrompt = Object.fromEntries(
        tasks.map((task, index) => [task.prompt, `${index + 1}`.padStart(SESSION_ID_A.length, "1")])
      );
      const { adapter, cli } = createAdapter(
        batchCli({ sessionIdByPrompt, statusOf: () => "Completed" })
      );

      const results = await adapter.runBatch(tasks, { maxConcurrent: 2 });

      expect(results.map((r) => r.outcome)).toEqual(tasks.map(() => JULES_BATCH_OUTCOMES.EMPTY));
      expect(actionsOf(cli)).toEqual([
        "new", "new", "list", "pull", "pull",
        "new", "new", "list", "pull", "pull",
        "new", "list", "pull",
      ]);
    });

    it("defaults to five sessions per wave", async () => {
      const tasks = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, prompt: `prompt-${id}` }));
      const sessionIdByPrompt = Object.fromEntries(
        tasks.map((task, index) => [task.prompt, `${index + 1}`.padStart(SESSION_ID_A.length, "1")])
      );
      const { adapter, cli } = createAdapter(
        batchCli({ sessionIdByPrompt, statusOf: () => "Completed" })
      );

      await adapter.runBatch(tasks);

      const actions = actionsOf(cli);
      const firstList = actions.indexOf("list");
      expect(actions.slice(0, JULES_ADAPTER_CONSTANTS.MAX_BATCH_MAX_CONCURRENT)).toEqual(
        Array.from({ length: JULES_ADAPTER_CONSTANTS.MAX_BATCH_MAX_CONCURRENT }, () => "new")
      );
      expect(firstList).toBe(JULES_ADAPTER_CONSTANTS.MAX_BATCH_MAX_CONCURRENT);
    });

    it("collects a list failure as failed for the unfinished tasks instead of throwing", async () => {
      const { adapter } = createAdapter(
        batchCli({ sessionIdByPrompt: SESSIONS_BY_PROMPT, statusOf: () => "", failList: true })
      );

      const results = await adapter.runBatch([TASK_ONE, TASK_TWO]);

      expect(results.map((r) => r.outcome)).toEqual([
        JULES_BATCH_OUTCOMES.FAILED,
        JULES_BATCH_OUTCOMES.FAILED,
      ]);
      expect(results[0]?.error).toContain("list failed");
    });

    it("returns no results and spawns nothing for an empty batch", async () => {
      const { adapter, cli } = createAdapter(batchCli({ sessionIdByPrompt: {}, statusOf: () => "" }));

      expect(await adapter.runBatch([])).toEqual([]);
      expect(cli.calls).toHaveLength(0);
    });

    it("rejects invalid maxConcurrent, duplicate ids and empty prompts before spawning anything", async () => {
      const { adapter, cli } = createAdapter(batchCli({ sessionIdByPrompt: SESSIONS_BY_PROMPT, statusOf: () => "" }));

      for (const maxConcurrent of [0, JULES_ADAPTER_CONSTANTS.MAX_BATCH_MAX_CONCURRENT + 1, 1.5]) {
        await expect(adapter.runBatch([TASK_ONE], { maxConcurrent })).rejects.toBeInstanceOf(PalError);
      }
      await expect(adapter.runBatch([TASK_ONE, { ...TASK_TWO, id: "t1" }])).rejects.toBeInstanceOf(PalError);
      await expect(adapter.runBatch([{ id: "t3", prompt: "   " }])).rejects.toBeInstanceOf(PalError);
      expect(cli.calls).toHaveLength(0);
    });

    it("accepts every maxConcurrent value from the minimum to the maximum", async () => {
      for (let value = JULES_ADAPTER_CONSTANTS.MIN_BATCH_MAX_CONCURRENT; value <= JULES_ADAPTER_CONSTANTS.MAX_BATCH_MAX_CONCURRENT; value += 1) {
        const { adapter } = createAdapter(batchCli({ sessionIdByPrompt: SESSIONS_BY_PROMPT, statusOf: () => "Completed" }));
        await expect(adapter.runBatch([TASK_ONE], { maxConcurrent: value })).resolves.toHaveLength(1);
      }
    });
  });

  describe("Prompt composition (buildJulesPrompt)", () => {
    it("composes the goal, exact files, verify command and standard constraints", () => {
      const prompt = buildJulesPrompt({
        goal: "Fix the parser edge case",
        files: ["src/parser.ts", "test/parser.test.ts"],
        verifyCommand: "bun test test/parser.test.ts",
        constraints: ["Keep the public API unchanged"],
      });

      expect(prompt).toContain("Goal: Fix the parser edge case");
      expect(prompt).toContain("- src/parser.ts\n- test/parser.test.ts");
      expect(prompt).toContain("`bun test test/parser.test.ts`");
      expect(prompt).toContain("Do not modify any file other than the files listed above.");
      expect(prompt).toContain("Do not open a pull request.");
      expect(prompt).toContain("- Keep the public API unchanged");
    });

    it("trims inputs and removes duplicate files", () => {
      const prompt = buildJulesPrompt({
        goal: "  Tidy  ",
        files: ["src/a.ts", " src/a.ts ", "  "],
        verifyCommand: "  bun test  ",
      });

      expect(prompt).toContain("Goal: Tidy\n");
      expect(prompt.match(/- src\/a\.ts/g)).toHaveLength(1);
      expect(prompt).toContain("`bun test`");
    });

    it("rejects a missing goal, no files, or a missing verify command", () => {
      expect(() => buildJulesPrompt({ goal: " ", files: ["a.ts"], verifyCommand: "bun test" })).toThrow(PalError);
      expect(() => buildJulesPrompt({ goal: "g", files: [], verifyCommand: "bun test" })).toThrow(PalError);
      expect(() => buildJulesPrompt({ goal: "g", files: ["a.ts"], verifyCommand: "" })).toThrow(PalError);
    });
  });

  describe("Prompt formatting", () => {
    it("joins system prompt and text turns, skipping non-text blocks", () => {
      const prompt = formatJulesPrompt({
        sessionId: "s",
        systemPrompt: "You are a careful worker.",
        messages: [
          createPalMessage({
            role: PAL_ROLES.USER,
            content: [createTextBlock("Add a README section")],
          }),
          createPalMessage({
            role: PAL_ROLES.ASSISTANT,
            content: [{ type: PAL_CONTENT_BLOCK_TYPES.THOUGHT, thought: "hidden" } as never],
          }),
        ],
      });

      expect(prompt).toContain("You are a careful worker.");
      expect(prompt).toContain("[user]\nAdd a README section");
      expect(prompt).not.toContain("hidden");
    });

    it("rejects an empty prompt with INVALID_REQUEST", () => {
      expect(() => formatJulesPrompt({ sessionId: "s", messages: [] })).toThrow(PalError);
    });
  });
});
