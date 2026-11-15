# Spec: Engine Decorators

## ADDED Requirements

### Requirement: Resilient Engine Decorator
The system MUST retry retryable engine failures with exponential backoff and full jitter, bounded by `maxRetries`, and MUST open a circuit breaker after `failureThreshold` consecutive failures.

#### Scenario: Transient error is retried then succeeds
- **WHEN** the wrapped engine returns `error` once and then `done`
- **THEN** the decorator returns `done`, sleeps once with a delay in `[0, baseDelayMs]`, and logs one `engine_retry` event

#### Scenario: Fatal and paused outcomes are not retried
- **WHEN** the wrapped engine returns `fatal` or `paused`
- **THEN** the decorator returns that outcome after exactly one call

#### Scenario: Circuit opens and recovers
- **WHEN** consecutive failures reach `failureThreshold`
- **THEN** subsequent calls return a `fatal` outcome with reason containing `circuit_open` without invoking the wrapped engine until `cooldownMs` has elapsed, after which one half-open trial is admitted

### Requirement: Telemetry Metrics Decorator
The system MUST record latency, cost, turns, token usage, retries and error category for every session and expose an aggregate summary.

#### Scenario: Summary aggregates sessions
- **WHEN** two sessions complete through the decorator, one `done` and one `error` with a rate-limit reason
- **THEN** `getSummary()` reports `sessions: 2`, summed cost, `outcomes.done: 1`, `outcomes.error: 1` and `errorsByCategory.rate_limit: 1`
