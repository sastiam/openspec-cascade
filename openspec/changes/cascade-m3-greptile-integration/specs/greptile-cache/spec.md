# Spec: Content-Addressed Greptile Cache

## ADDED Requirements

### Requirement: SHA-256 Composite Keys With TTL
The system MUST store results under `.cascade/cache/greptile/` keyed by SHA-256 of `(baseSha, diffHash, query)`, expire entries after `ttlMs`, and write atomically.

#### Scenario: Hit, miss and expiry
- **WHEN** a value is set and read back with the same components, read with a different `diffHash`, and read after `ttlMs`
- **THEN** the reads return the value, `undefined`, and `undefined` (with the expired file deleted)

### Requirement: Fail-Open and Fail-Closed Policies
The system MUST treat corrupt entries as misses under `fail-open` and raise `GreptileCacheError` under `fail-closed`.

#### Scenario: Corrupt entry
- **WHEN** the cache file for a key contains invalid JSON
- **THEN** `get` returns `undefined` under `fail-open` and throws `GreptileCacheError` under `fail-closed`
