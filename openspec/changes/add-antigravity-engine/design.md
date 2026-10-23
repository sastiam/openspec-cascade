# Design: Antigravity CLI Engine Integration

## Context

`openspec-cascade` runs tasks sequentially via agent engines (`cascade.ts`). `opencode.ts` provides a blueprint for CLI-based subprocessing with streaming NDJSON, failure classification, and session resumption. The Google Antigravity CLI (`agy`) exposes print mode (`agy -p`) with streaming JSON (`--output-format stream-json`), session continuation (`--conversation <id>`), and auto-approval (`--dangerously-skip-permissions`).

## Goals / Non-Goals

**Goals:**
- Provide a clean, standalone `antigravity.ts` module implementing `runAntigravitySession`.
- Mirror `opencode.ts` patterns for streaming stdout chunks, reducing JSON lines, tracking token usage, and reporting progress.
- Dispatch seamlessly in `cascade.ts` when `--engine antigravity` or `--engine agy` is specified.
- Enable full unit test coverage in `antigravity.test.ts`.

**Non-Goals:**
- In-process SDK bindings (the Antigravity Python SDK is out of scope; `agy` CLI subprocessing fits the existing Bun/TypeScript architecture).
- Programmatic bash permission interception (enforced via prompt instructions and `--dangerously-skip-permissions`, aligned with user decision).
- Plan usage meter API integration (Antigravity CLI currently relies on standard pause/retry on rate limit).

## Decisions

### 1. Module Structure: `antigravity.ts`
- **Choice**: Create `antigravity.ts` patterned after `opencode.ts`.
- **Rationale**: Isolates CLI process lifecycle, NDJSON parsing, and event mapping. Simplifies testing without requiring child processes to be spawned during unit tests.

### 2. Event Stream Mapping
- **Choice**:
  - `event: "init"`: Store `conversation_id`.
  - `event: "step_update"` with `step_type: "tool"`: Invoke `hooks.onTool(step_update.tool_name, step_update.tool_info)`.
  - `event: "step_update"` with `step_type: "agent_response"`: If `text_delta` present, invoke `hooks.onText(delta)`.
  - `event: "result"`: Capture `result.status`, `result.response`, and `result.usage` tokens.
- **Alternatives considered**: Parsing `event: "result"` only, but that misses live terminal progress spinners and tool logs.

### 3. Session Resumption
- **Choice**: Use `--conversation <conversation_id>` when resuming sessions across retry attempts.
- **Rationale**: Tested and verified with `agy` CLI; maintains conversational context when recovering from task check failures.

### 4. Error and Rate Limit Classification
- **Choice**: Classify failures into:
  - `fatal`: Unrecoverable errors (e.g. invalid credentials, missing binary).
  - `paused`: Rate limits, 429s, or `RESOURCE_EXHAUSTED` (pauses cascade before retrying).
  - `error`: General execution errors (eligible for task-level retry up to 3 attempts).

## Risks / Trade-offs

- [Risk] `agy` not found in PATH when user runs `--engine antigravity`.
  → Mitigation: Throw a clear, actionable error instructing how to install or add `agy` to PATH.
- [Risk] Formatting changes in `agy` NDJSON output across versions.
  → Mitigation: Guard parsing with try/catch, fallback to generic line processing, and write unit tests against real event samples.
