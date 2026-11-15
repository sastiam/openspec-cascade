# Design: Milestone M5

## Decisions

### Decision 1: Append-Only, Redacted JSONL Telemetry
- **Structure:** One file per UTC day under `telemetry.telemetryDir` (default `.cascade/telemetry`); every record passes through `redactSensitiveData` before serialization; malformed lines are skipped on read.
- **Rationale:** Crash-safe appends, trivial rotation, no secrets on disk.

### Decision 2: Signature Normalization and Bounded Directives
- **Structure:** Signatures lowercase the trace, replace absolute/relative paths, hex hashes, numbers and quoted literals with placeholders, keep the first `SIGNATURE_MAX_CHARS`, and hash with SHA-256. Directives are emitted only for signatures with `>= MIN_OCCURRENCES` failures, sorted by frequency then recency, capped at `MAX_DIRECTIVES`, with category templates (`type_error`, `test_failure`, `lint`, `timeout`, `rate_limit`, `auth`, `unknown`) plus a trimmed example.
- **Rationale:** Prevents prompt bloat and makes directives deterministic for identical history.

### Decision 3: Pre-PR Loop Policy
- **Structure:** `status` is one of `clean`, `needs_human`, `exhausted`, `stale`, `mismatch`, `empty`. Round budget is `min(requested, PRE_PR_CONSTANTS.MAX_ROUNDS)`. Risky findings never reach the fixer.
- **Rationale:** Mechanical fixes are safe to automate; security/concurrency/data-loss findings require a human.

### Decision 4: Subcommands Before Flag Parsing
- **Structure:** `runCli` checks `argv[0]` against `CLI_SUBCOMMANDS`; each subcommand owns a strict `parseArgs` schema and returns an exit code (`0` ok, `1` findings/drift/unhealthy, `2` invalid input or fail-closed errors). The legacy flag interface is untouched.
- **Rationale:** Backward compatibility with every existing invocation.

### Decision 5: Dual-Runtime CI
- **Structure:** Job `bun` (Bun 1.4: install, typecheck, lint, audit, sync check, OpenSpec validation, `bun test`) and job `node24` (Bun for dependency install, Node 24 for `npm run test:node`).
- **Installation:** The workflow is versioned as `ci/github-workflows/ci.yml` and installed with `mkdir -p .github/workflows && cp ci/github-workflows/ci.yml .github/workflows/ci.yml` by a maintainer whose GitHub credential has the `workflow` scope (automation tokens without it cannot push workflow files). A test keeps the installed copy identical to the template.
- **Rationale:** Certifies both runtimes on every push and pull request.
