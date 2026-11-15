/**
 * Security and AWS Well-Architected guardrails for openspec-cascade.
 *
 * Enforces fail-closed session/total USD budget boundaries, cycle-safe and
 * container-preserving sensitive data redaction, and protected-branch safety.
 */

import { BUDGET_CONSTANTS, EXIT_CODE_CONSTANTS, GUARDRAIL_CONSTANTS } from "./constants";

export type BudgetScope = "session" | "total";

/**
 * Error thrown when spent USD meets or exceeds the configured budget or when inputs are invalid.
 */
export class BudgetExceededError extends Error {
  readonly spentUsd: number;
  readonly maxBudgetUsd: number;
  readonly scope: BudgetScope;
  readonly exitCode: number = EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;

  constructor(message: string, spentUsd: number, maxBudgetUsd: number, scope: BudgetScope = "session") {
    super(message);
    this.name = "BudgetExceededError";
    this.spentUsd = spentUsd;
    this.maxBudgetUsd = maxBudgetUsd;
    this.scope = scope;
  }
}

/**
 * Error thrown when execution attempts to mutate a protected git branch without dry-run.
 */
export class ProtectedBranchError extends Error {
  readonly branch: string;
  readonly exitCode: number = EXIT_CODE_CONSTANTS.EXIT_CODE_FATAL;

  constructor(branch: string, message = `Refusing to run on protected branch "${branch}"`) {
    super(message);
    this.name = "ProtectedBranchError";
    this.branch = branch;
  }
}

export interface ProtectedBranchGuardInput {
  branch: string;
  protectedBranches: readonly string[];
  dryRun: boolean;
}

export interface ProtectedBranchGuardResult {
  allowed: boolean;
  isProtected: boolean;
  warning?: string;
}

/**
 * Enforces strict fail-closed USD budget limits, rejecting NaN, non-finite, negative, and >= boundary values.
 */
export function enforceSessionBudget(
  spentUsd: number,
  maxBudgetUsd: number,
  scope: BudgetScope = "session",
): void {
  if (!Number.isFinite(spentUsd) || spentUsd < BUDGET_CONSTANTS.MIN_BUDGET_USD) {
    throw new BudgetExceededError(
      `Invalid ${scope} spend amount (${String(spentUsd)}); failing closed`,
      spentUsd,
      maxBudgetUsd,
      scope,
    );
  }
  if (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= BUDGET_CONSTANTS.MIN_BUDGET_USD) {
    throw new BudgetExceededError(
      `Invalid ${scope} budget limit (${String(maxBudgetUsd)}); failing closed`,
      spentUsd,
      maxBudgetUsd,
      scope,
    );
  }
  if (spentUsd >= maxBudgetUsd) {
    throw new BudgetExceededError(
      `${scope === "total" ? "Total" : "Session"} budget of $${maxBudgetUsd} reached (spent $${spentUsd})`,
      spentUsd,
      maxBudgetUsd,
      scope,
    );
  }
}

/**
 * Evaluates whether execution may proceed on the current git branch.
 */
export function evaluateProtectedBranchGuard(
  input: ProtectedBranchGuardInput,
): ProtectedBranchGuardResult {
  const branch = input.branch.trim();
  const isProtected = input.protectedBranches.includes(branch);
  if (!isProtected) {
    return { allowed: true, isProtected: false };
  }
  if (input.dryRun) {
    return {
      allowed: true,
      isProtected: true,
      warning: `Running --dry-run on protected branch "${branch}" (read-only preview)`,
    };
  }
  return {
    allowed: false,
    isProtected: true,
    warning: `Refusing to run on protected branch "${branch}"`,
  };
}

/**
 * Evaluates protected-branch policy and throws ProtectedBranchError when non-dry-run mutation is blocked.
 */
export function assertBranchSafety(input: ProtectedBranchGuardInput): ProtectedBranchGuardResult {
  const result = evaluateProtectedBranchGuard(input);
  if (!result.allowed) {
    throw new ProtectedBranchError(input.branch.trim(), result.warning);
  }
  return result;
}

const TOKEN_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{12,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];

const PEM_PRIVATE_KEY_REGEX =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

const URL_CREDENTIALS_REGEX = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/g;

function redactStringPatterns(input: string): string {
  let result = input.replace(PEM_PRIVATE_KEY_REGEX, GUARDRAIL_CONSTANTS.REDACTED_VALUE);
  result = result.replace(URL_CREDENTIALS_REGEX, `$1$2:${GUARDRAIL_CONSTANTS.REDACTED_VALUE}@`);
  for (const pattern of TOKEN_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    result = result.replace(regex, (match) =>
      /^Bearer\s+/i.test(match) ? `Bearer ${GUARDRAIL_CONSTANTS.REDACTED_VALUE}` : GUARDRAIL_CONSTANTS.REDACTED_VALUE,
    );
  }
  return result;
}

function isSensitiveKey(key: unknown): boolean {
  return typeof key === "string" && GUARDRAIL_CONSTANTS.SENSITIVE_KEY_PATTERN.test(key);
}

function normalizeMaxDepth(maxDepth: number): number {
  if (!Number.isFinite(maxDepth) || maxDepth < 0) {
    return 0;
  }
  return Math.floor(maxDepth);
}

function defineOwnEnumerableProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function redactErrorValue(
  err: Error,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): Error {
  seen.add(err);
  try {
    const cloned = new Error(redactStringPatterns(err.message));
    cloned.name = err.name;
    if (typeof err.stack === "string") {
      cloned.stack = redactStringPatterns(err.stack);
    }
    const extraEntries = Object.entries(err);
    for (const [key, propVal] of extraEntries) {
      const nextVal =
        isSensitiveKey(key) && propVal !== undefined && propVal !== null
          ? GUARDRAIL_CONSTANTS.REDACTED_VALUE
          : redactNode(propVal, depth + 1, maxDepth, seen);
      defineOwnEnumerableProperty(cloned, key, nextVal);
    }
    return cloned;
  } finally {
    seen.delete(err);
  }
}

function redactArrayValue(
  items: readonly unknown[],
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): unknown[] {
  seen.add(items);
  try {
    return items.map((item) => redactNode(item, depth + 1, maxDepth, seen));
  } finally {
    seen.delete(items);
  }
}

function redactSetValue(
  items: ReadonlySet<unknown>,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): Set<unknown> {
  seen.add(items);
  try {
    const cloned = new Set<unknown>();
    for (const item of items) {
      cloned.add(redactNode(item, depth + 1, maxDepth, seen));
    }
    return cloned;
  } finally {
    seen.delete(items);
  }
}

function redactMapValue(
  entries: ReadonlyMap<unknown, unknown>,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): Map<unknown, unknown> {
  seen.add(entries);
  try {
    const cloned = new Map<unknown, unknown>();
    for (const [key, val] of entries.entries()) {
      const nextKey = isSensitiveKey(key) ? key : redactNode(key, depth + 1, maxDepth, seen);
      const nextVal =
        isSensitiveKey(key) && val !== undefined && val !== null
          ? GUARDRAIL_CONSTANTS.REDACTED_VALUE
          : redactNode(val, depth + 1, maxDepth, seen);
      cloned.set(nextKey, nextVal);
    }
    return cloned;
  } finally {
    seen.delete(entries);
  }
}

function redactRecordValue(
  record: Record<string, unknown>,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  seen.add(record);
  try {
    const cloned = (
      Object.getPrototypeOf(record) === null ? Object.create(null) : {}
    ) as Record<string, unknown>;
    for (const [key, val] of Object.entries(record)) {
      const nextVal =
        isSensitiveKey(key) && val !== undefined && val !== null
          ? GUARDRAIL_CONSTANTS.REDACTED_VALUE
          : redactNode(val, depth + 1, maxDepth, seen);
      defineOwnEnumerableProperty(cloned, key, nextVal);
    }
    return cloned;
  } finally {
    seen.delete(record);
  }
}

function redactNode(
  value: unknown,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return redactStringPatterns(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }
  if (seen.has(value)) {
    return GUARDRAIL_CONSTANTS.CIRCULAR_REF_MARKER;
  }
  if (depth >= maxDepth) {
    return GUARDRAIL_CONSTANTS.MAX_DEPTH_MARKER;
  }
  if (Array.isArray(value)) {
    return redactArrayValue(value, depth, maxDepth, seen);
  }
  if (value instanceof Set) {
    return redactSetValue(value, depth, maxDepth, seen);
  }
  if (value instanceof Map) {
    return redactMapValue(value, depth, maxDepth, seen);
  }
  if (value instanceof Error) {
    return redactErrorValue(value, depth, maxDepth, seen);
  }
  return redactRecordValue(value as Record<string, unknown>, depth, maxDepth, seen);
}

/**
 * Recursively clones and redacts secrets, credentials, and sensitive keys while guarding cycles and depth.
 */
export function redactSensitiveData<T>(
  value: T,
  maxDepth: number = GUARDRAIL_CONSTANTS.MAX_REDACTION_DEPTH,
): T {
  const effectiveMaxDepth = normalizeMaxDepth(maxDepth);
  const seen = new WeakSet<object>();
  return redactNode(value, 0, effectiveMaxDepth, seen) as T;
}
