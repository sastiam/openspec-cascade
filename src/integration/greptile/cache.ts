/**
 * Content-addressed disk cache for Greptile results.
 *
 * Keys are SHA-256 digests of `(baseSha, diffHash, query)`, so a result is reused only
 * for the exact same merge-base, the exact same diff and the exact same question.
 * Writes are atomic (temp file + rename). Corrupt or unreadable entries are a miss
 * under `fail-open` and an error under `fail-closed`.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { GREPTILE_CONSTANTS } from "../../config/constants";

export type CachePolicy = "fail-open" | "fail-closed";

export interface CacheKeyComponents {
  readonly baseSha: string;
  readonly diffHash: string;
  readonly query: string;
}

export interface CacheEntry<T> {
  readonly version: number;
  readonly key: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly value: T;
}

export interface GreptileCacheOptions<T> {
  /** Cache directory; relative paths resolve against `rootDir`. */
  readonly dir?: string;
  readonly rootDir?: string;
  readonly ttlMs?: number;
  readonly policy?: CachePolicy;
  readonly now?: () => number;
  /** Validates a cached value; returning `undefined` treats the entry as corrupt. */
  readonly validate?: (value: unknown) => T | undefined;
}

export class GreptileCacheError extends Error {
  readonly key: string;

  constructor(key: string, message: string) {
    super(`greptile cache entry ${key}: ${message}`);
    this.name = "GreptileCacheError";
    this.key = key;
  }
}

/**
 * SHA-256 hex digest of arbitrary text (used for diff hashes).
 */
export function sha256(text: string): string {
  return createHash(GREPTILE_CONSTANTS.HASH_ALGORITHM).update(text).digest("hex");
}

/**
 * Composite cache key. Components are JSON-encoded to make the key injective.
 */
export function cacheKey(components: CacheKeyComponents): string {
  return sha256(JSON.stringify([components.baseSha, components.diffHash, components.query]));
}

function isCacheEntry(value: unknown): value is CacheEntry<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === GREPTILE_CONSTANTS.CACHE_SCHEMA_VERSION &&
    typeof record.key === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.expiresAt === "number" &&
    "value" in record
  );
}

export class GreptileCache<T> {
  readonly dir: string;
  private readonly ttlMs: number;
  private readonly policy: CachePolicy;
  private readonly now: () => number;
  private readonly validate: (value: unknown) => T | undefined;

  constructor(options: GreptileCacheOptions<T> = {}) {
    const dir = options.dir ?? GREPTILE_CONSTANTS.DEFAULT_CACHE_DIR;
    this.dir = isAbsolute(dir) ? dir : join(options.rootDir ?? process.cwd(), dir);
    this.ttlMs = options.ttlMs ?? GREPTILE_CONSTANTS.DEFAULT_CACHE_TTL_MS;
    this.policy = options.policy ?? GREPTILE_CONSTANTS.DEFAULT_CACHE_POLICY;
    this.now = options.now ?? Date.now;
    this.validate = options.validate ?? ((value) => value as T);
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key}${GREPTILE_CONSTANTS.CACHE_FILE_EXTENSION}`);
  }

  private corrupt(key: string, message: string): undefined {
    if (this.policy === "fail-closed") {
      throw new GreptileCacheError(key, message);
    }
    return undefined;
  }

  /**
   * Returns the cached value, or `undefined` on miss/expiry (and on corruption under `fail-open`).
   */
  get(components: CacheKeyComponents): T | undefined {
    const key = cacheKey(components);
    let raw: string;
    try {
      raw = readFileSync(this.pathFor(key), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      return this.corrupt(key, error instanceof Error ? error.message : String(error));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.corrupt(key, "invalid JSON");
    }
    if (!isCacheEntry(parsed) || parsed.key !== key) {
      return this.corrupt(key, "invalid entry envelope");
    }
    if (parsed.expiresAt <= this.now()) {
      rmSync(this.pathFor(key), { force: true });
      return undefined;
    }
    const value = this.validate(parsed.value);
    return value === undefined ? this.corrupt(key, "value failed validation") : value;
  }

  /**
   * Atomically stores `value` under the composite key.
   */
  set(components: CacheKeyComponents, value: T): CacheEntry<T> {
    const key = cacheKey(components);
    const createdAt = this.now();
    const entry: CacheEntry<T> = {
      version: GREPTILE_CONSTANTS.CACHE_SCHEMA_VERSION,
      key,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      value,
    };
    mkdirSync(this.dir, { recursive: true });
    const tempPath = `${this.pathFor(key)}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(entry));
    renameSync(tempPath, this.pathFor(key));
    return entry;
  }

  /**
   * Deletes expired and unreadable entries. Returns the number of files removed.
   */
  prune(): number {
    let removed = 0;
    let files: string[];
    try {
      files = readdirSync(this.dir);
    } catch {
      return 0;
    }
    for (const file of files) {
      const path = join(this.dir, file);
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (isCacheEntry(parsed) && parsed.expiresAt > this.now()) continue;
      } catch {
        removed += 0;
      }
      rmSync(path, { force: true });
      removed++;
    }
    return removed;
  }
}
