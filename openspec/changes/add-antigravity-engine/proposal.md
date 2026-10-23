# Proposal: Add Antigravity CLI Engine

## Why

`openspec-cascade` enables running OpenSpec changes autonomously using agent sessions. Currently, it supports the Claude Agent SDK and the OpenCode CLI. Adding support for the Antigravity CLI (`agy`) allows developers working within Google Antigravity environments to use `gemini-3.8-flash-high` and other Antigravity-supported models natively to execute cascades, re-using existing Antigravity authentication and tooling.

## What Changes

- Add `--engine antigravity` and alias `--engine agy` to the CLI options in `cascade.ts`.
- Implement `antigravity.ts` to manage subprocessing for `agy -p "<prompt>" --output-format stream-json --dangerously-skip-permissions`.
- Support session resumption across task turns using `--conversation <conversation_id>`.
- Default to model `gemini-3.8-flash-high` with reasoning effort configurable via `CASCADE_EFFORT` and model selection via `CASCADE_MODEL`.
- Parse NDJSON streaming events (`init`, `step_update`, `result`) to log tool invocations, render progress spinners, and capture token usage.
- Add unit tests in `antigravity.test.ts` covering argument mapping, stream event reduction, and failure classification.
- Document Antigravity CLI engine requirements and usage in `README.md`.

## Capabilities

### New Capabilities
- `engine-antigravity`: Native support for executing cascade task sessions using the Antigravity CLI (`agy`).

### Modified Capabilities
<!-- None: No existing specs exist in this repository. -->

## Impact

- **CLI Interface**: Introduces `antigravity` and `agy` as valid values for `--engine`.
- **Dependencies**: Requires `agy` CLI installed in PATH when using `--engine antigravity`.
- **Runtime Code**: Adds `antigravity.ts`, modifies `cascade.ts`.
- **Tests**: Adds `antigravity.test.ts`.
