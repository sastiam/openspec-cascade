/**
 * OpenCode engine for the cascade: one `opencode run --format json` process per session.
 *
 * Event shapes follow @opencode-ai/sdk (TextPart, ToolPart, StepFinishPart). The CLI's JSON envelope is not
 * documented, so parts are looked up in `event.part` or `event.properties.part`, and unknown events are ignored.
 */

export const OPENCODE_DEFAULT_MODEL = "opencode/deepseek-v4.1-flash"; // OpenCode Zen
const SESSION_TIMEOUT_MS = 45 * 60_000;
const RATE_LIMIT_SLEEP_MS = 30 * 60_000;
const RATE_LIMIT = /rate.?limit|\b429\b|quota|usage limit|too many requests/i;
// Waiting or retrying never fixes these: stop the cascade
const UNRECOVERABLE = /provider\.auth|invalid credential|"status":\s*(401|403)\b|unauthorized|model not found/i;

export type OpenCodeOutcome =
  | { kind: "done"; sessionId?: string; result: string; costUsd: number }
  | { kind: "paused"; sessionId?: string; resumeAt: number; costUsd: number }
  | { kind: "error"; sessionId?: string; reason: string; costUsd: number }
  | { kind: "fatal"; reason: string; costUsd: number };

type Hooks = {
  onTool: (name: string, input: unknown) => void;
  onText: (text: string) => void;
  log: (event: string, data: Record<string, unknown>) => void;
};

/** `provider/model#variant`; the variant carries the reasoning effort unless the model already names one. */
export function openCodeModelArg(model: string | undefined, effort: string | undefined) {
  const base = model ?? OPENCODE_DEFAULT_MODEL;
  return base.includes("#") || !effort || effort === "none" ? base : `${base}#${effort}`;
}

/** Claude-style deny rules ("Bash(git push *)") become OpenCode bash patterns ("git push *"). */
export function openCodePermission(deniedBash: string[]) {
  const bash: Record<string, string> = { "*": "allow" };
  for (const rule of deniedBash) {
    const pattern = rule.match(/^Bash\((.+)\)$/)?.[1];
    if (pattern) bash[pattern] = "deny";
  }
  return { edit: "allow", webfetch: "allow", bash };
}

export type SessionState = { sessionId?: string; texts: Map<string, string>; costUsd: number; error?: string };

/** Folds one JSON line from `opencode run --format json` into the session state. */
export function reduceOpenCodeEvent(state: SessionState, line: string, hooks: Pick<Hooks, "onTool" | "onText">) {
  let event: Record<string, any>;
  try {
    event = JSON.parse(line);
  } catch {
    return; // non-JSON noise (banners, warnings)
  }
  const part = event.part ?? event.properties?.part;
  state.sessionId ??= event.sessionID ?? part?.sessionID;

  if (event.type === "error" || event.error) {
    state.error = typeof event.error === "string" ? event.error : JSON.stringify(event.error ?? event);
  }
  if (!part) return;

  if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
    const isNew = !state.texts.has(part.id);
    state.texts.set(part.id, part.text);
    if (isNew) hooks.onText(part.text);
  } else if (part.type === "tool" && ["completed", "error"].includes(part.state?.status)) {
    hooks.onTool(part.tool, part.state?.input);
  } else if (part.type === "step-finish" && typeof part.cost === "number") {
    state.costUsd += part.cost;
  }
}

export function classifyFailure(failure: string): "fatal" | "paused" | "error" {
  if (UNRECOVERABLE.test(failure)) return "fatal";
  return RATE_LIMIT.test(failure) ? "paused" : "error";
}

export async function runOpenCodeSession(options: {
  prompt: string;
  cwd: string;
  resume?: string;
  model: string;
  deniedBash: string[];
  hooks: Hooks;
}): Promise<OpenCodeOutcome> {
  const argv = ["opencode", "run", "--format", "json", "--auto", "--model", options.model, "--title", "openspec-cascade"];
  if (options.resume) argv.push("--session", options.resume);
  argv.push(options.prompt);

  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: SESSION_TIMEOUT_MS,
    // Highest-precedence config: permissions for this run only, over the project's opencode.json
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: openCodePermission(options.deniedBash) }) },
  });

  const state: SessionState = { sessionId: options.resume, texts: new Map(), costUsd: 0 };
  const stderr = new Response(proc.stderr).text();
  let buffer = "";
  for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
    buffer += new TextDecoder().decode(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) reduceOpenCodeEvent(state, line, options.hooks);
  }
  if (buffer) reduceOpenCodeEvent(state, buffer, options.hooks);

  const code = await proc.exited;
  const errText = (await stderr).trim();
  options.hooks.log("opencode_exit", { code, cost: state.costUsd, error: state.error, stderr: errText.slice(-500) });

  const failure = state.error ?? (code !== 0 ? `exit ${code}: ${errText.slice(-300)}` : undefined);
  const kind = failure ? classifyFailure(failure) : undefined;
  if (kind === "fatal") return { kind, reason: `OpenCode: ${failure}`, costUsd: state.costUsd };
  if (kind === "paused") {
    return { kind, sessionId: state.sessionId, resumeAt: Date.now() + RATE_LIMIT_SLEEP_MS, costUsd: state.costUsd };
  }
  if (kind === "error") return { kind, sessionId: state.sessionId, reason: failure!, costUsd: state.costUsd };
  return { kind: "done", sessionId: state.sessionId, result: [...state.texts.values()].join("\n"), costUsd: state.costUsd };
}
