/**
 * OpenCode engine for the cascade: one `opencode run --format json` process per session.
 *
 * Event shapes follow @opencode-ai/sdk (TextPart, ToolPart, StepFinishPart). The CLI's JSON envelope is not
 * documented, so parts are looked up in `event.part` or `event.properties.part`, and unknown events are ignored.
 */

import { CONSTANTS } from "./config";
import { classifyEngineFailure, toCliSessionOutcome, type EngineFailureKind, type EngineFailurePatterns } from "./src/pal/shared";
import { getDefaultSpawner } from "./src/runtime/spawner";
import { forEachStreamLine } from "./src/runtime/streams";
import type { ISpawner } from "./src/runtime/types";
import type {
  EngineAdapter,
  EngineHooks,
  EngineOutcome,
  EngineSessionOptions,
} from "./src/engine/contract";

export const OPENCODE_DEFAULT_MODEL = CONSTANTS.DEFAULT_OPENCODE_MODEL;
const SESSION_TIMEOUT_MS = CONSTANTS.OPENCODE_SESSION_TIMEOUT_MS;
const RATE_LIMIT_SLEEP_MS = CONSTANTS.RATE_LIMIT_SLEEP_MS;
const RATE_LIMIT = /rate.?limit|\b429\b|quota|usage limit|too many requests/i;
/** Waiting or retrying never fixes auth/model errors; stop the cascade immediately. */
const UNRECOVERABLE = /provider\.auth|invalid credential|"status":\s*(401|403)\b|unauthorized|model not found/i;

export type OpenCodeOutcome = EngineOutcome;

export type Hooks = EngineHooks;

/** `provider/model#variant`; the variant carries the reasoning effort unless the model already names one. */
export function openCodeModelArg(model: string | undefined, effort: string | undefined): string {
  const base = model ?? OPENCODE_DEFAULT_MODEL;
  return base.includes("#") || !effort || effort === "none" ? base : `${base}#${effort}`;
}

/** Claude-style deny rules ("Bash(git push *)") become OpenCode bash patterns ("git push *"). */
export function openCodePermission(deniedBash: string[] | readonly string[]): {
  edit: string;
  webfetch: string;
  bash: Record<string, string>;
} {
  const bash: Record<string, string> = { "*": "allow" };
  for (const rule of deniedBash) {
    const pattern = rule.match(/^Bash\((.+)\)$/)?.[1];
    if (pattern) bash[pattern] = "deny";
  }
  return { edit: "allow", webfetch: "allow", bash };
}

export type SessionState = { sessionId?: string; texts: Map<string, string>; costUsd: number; error?: string };

interface OpenCodeRawPart {
  id?: string;
  sessionID?: string;
  type?: string;
  text?: string;
  tool?: string;
  cost?: number;
  state?: {
    status?: string;
    input?: unknown;
  };
}

interface OpenCodeRawEvent {
  type?: string;
  sessionID?: string;
  error?: unknown;
  part?: OpenCodeRawPart;
  properties?: {
    part?: OpenCodeRawPart;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Folds one JSON line from `opencode run --format json` into the session state. */
export function reduceOpenCodeEvent(
  state: SessionState,
  line: string,
  hooks: Pick<Hooks, "onTool" | "onText">,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  const event = parsed as OpenCodeRawEvent;
  const part = event.part ?? event.properties?.part;
  state.sessionId ??= event.sessionID ?? part?.sessionID;

  if (event.type === "error" || event.error) {
    state.error = typeof event.error === "string" ? event.error : JSON.stringify(event.error ?? event);
  }
  if (!part) return;

  if (part.type === "text" && typeof part.text === "string" && part.text.trim() && part.id) {
    const isNew = !state.texts.has(part.id);
    state.texts.set(part.id, part.text);
    if (isNew) hooks.onText(part.text);
  } else if (
    part.type === "tool" &&
    part.tool &&
    part.state?.status &&
    ["completed", "error"].includes(part.state.status)
  ) {
    hooks.onTool(part.tool, part.state.input);
  } else if (part.type === "step-finish" && typeof part.cost === "number") {
    state.costUsd += part.cost;
  }
}

const FAILURE_PATTERNS: EngineFailurePatterns = { rateLimit: RATE_LIMIT, unrecoverable: UNRECOVERABLE };

export function classifyFailure(failure: string): EngineFailureKind {
  return classifyEngineFailure(failure, FAILURE_PATTERNS);
}

export async function runOpenCodeSession(options: {
  prompt: string;
  cwd: string;
  resume?: string;
  model: string;
  deniedBash: string[];
  hooks: Hooks;
  timeoutMs?: number;
  spawner?: ISpawner;
}): Promise<OpenCodeOutcome> {
  const argv = ["opencode", "run", "--format", "json", "--auto", "--model", options.model, "--title", "openspec-cascade"];
  if (options.resume) argv.push("--session", options.resume);
  argv.push(options.prompt);

  const proc = (options.spawner ?? getDefaultSpawner()).spawn(argv, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? SESSION_TIMEOUT_MS,
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: openCodePermission(options.deniedBash) }) },
  });

  const state: SessionState = { sessionId: options.resume, texts: new Map(), costUsd: 0 };
  const stderr = new Response(proc.stderr).text();
  await forEachStreamLine(proc.stdout, (line) => reduceOpenCodeEvent(state, line, options.hooks));

  const code = await proc.exitCode;
  const errText = (await stderr).trim();
  options.hooks.log("opencode_exit", { code, cost: state.costUsd, error: state.error, stderr: errText.slice(-CONSTANTS.STDERR_TAIL_MAX_LENGTH) });

  const failure = state.error ?? (code !== CONSTANTS.EXIT_CODE_SUCCESS ? `exit ${code}: ${errText.slice(-CONSTANTS.ERROR_DETAIL_MAX_LENGTH)}` : undefined);
  return toCliSessionOutcome({
    engineLabel: "OpenCode",
    failure,
    patterns: FAILURE_PATTERNS,
    sessionId: state.sessionId,
    costUsd: state.costUsd,
    result: [...state.texts.values()].join("\n"),
    rateLimitSleepMs: RATE_LIMIT_SLEEP_MS,
  });
}

/**
 * Adapter implementing EngineAdapter for OpenCode CLI runner.
 */
export interface OpenCodeAdapterOptions {
  readonly spawner?: ISpawner;
}

export class OpenCodeAdapter implements EngineAdapter {
  readonly name = "opencode" as const;
  private readonly spawner?: ISpawner;

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.spawner = options.spawner;
  }

  getDefaultModel(effort?: string): string {
    return openCodeModelArg(undefined, effort);
  }

  supportsPlanMeters(): boolean {
    return false;
  }

  async runSession(options: EngineSessionOptions): Promise<EngineOutcome> {
    const model = options.model
      ? openCodeModelArg(options.model, options.effort)
      : this.getDefaultModel(options.effort);
    const deniedBash = options.deniedBash
      ? [...options.deniedBash]
      : options.config
      ? [...options.config.deniedBash]
      : [...CONSTANTS.DENIED_BASH];

    return runOpenCodeSession({
      prompt: options.prompt,
      cwd: options.cwd,
      resume: options.resume,
      model,
      deniedBash,
      hooks: options.hooks,
      timeoutMs: options.config?.engineSessionTimeoutMs,
      spawner: this.spawner,
    });
  }
}

export const openCodeAdapter: OpenCodeAdapter = new OpenCodeAdapter();
