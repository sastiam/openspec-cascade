# Spec: PAL Engine Factory

## ADDED Requirements

### Requirement: Engine Factory Unifies All Engines
The system MUST create engines for `claude`, `opencode`, `antigravity`, `gemini` (alias of `antigravity`) and `jules` through `EngineFactory.create`, returning a `UnifiedEngine` that implements the session-level `EngineAdapter` contract and exposes its `IPalProvider` via `getProvider()`.

#### Scenario: Each engine type is constructible
- **WHEN** `EngineFactory.create(engine)` is called for each supported engine name
- **THEN** it returns a `UnifiedEngine` whose `engineType` is the canonical name and whose `getProvider().providerName` matches the provider family

#### Scenario: Unknown engine fails closed
- **WHEN** `EngineFactory.create("unknown")` is called
- **THEN** it throws `ConfigValidationError` with `exitCode` `2`

### Requirement: IPalProvider To EngineAdapter Bridge
The system MUST adapt any `IPalProvider` to `EngineAdapter` through `PalEngineBridge`, mapping a completed turn to a `done` outcome, rate-limit errors to `paused`, non-retryable authentication or validation errors to `fatal`, and other errors to `error`.

#### Scenario: Successful turn maps to done
- **WHEN** the provider returns a message with text content
- **THEN** `runSession` resolves `{ kind: "done", result: <text> }` and reports the text through `hooks.onText`

#### Scenario: Provider rate limit maps to paused
- **WHEN** the provider throws a `PalError` of kind `rate_limit`
- **THEN** `runSession` resolves a `paused` outcome with a future `resumeAt`

### Requirement: Jules Headless Authentication Documented
The system MUST document the Jules authentication model (interactive `jules login` for the CLI, `X-Goog-Api-Key` for the REST API) in the `looper-pal-jules-adapter` change, closing task `1.2`.

#### Scenario: Jules change is complete
- **WHEN** `openspec list` runs
- **THEN** `looper-pal-jules-adapter` reports all tasks complete
