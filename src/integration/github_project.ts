/**
 * GitHub Projects V2 Integration Service.
 *
 * Implements the Provider-Agnostic Multi-Agent Looper specification defined in
 * `projects/agnostic_looper/SPECIFICATION.md` Section 6.4 & 6.5 (LOOPER-INT-002)
 * and OpenSpec change `looper-integration-github-project` Task 1.1.
 *
 * Provides typed GraphQL client communication with GitHub Projects V2 via
 * ambient gh CLI or custom executor, project metadata retrieval, fields and single-select
 * option resolution, item queries, item normalization, and field mutation primitives.
 */

import { spawn } from "node:child_process";

/**
 * Constants ensuring zero magic numbers across GitHub Projects V2 integration.
 */
export const GITHUB_PROJECT_CONSTANTS = {
  DEFAULT_OWNER: "sastiam",
  DEFAULT_OWNER_TYPE: "user" as const,
  DEFAULT_PROJECT_NUMBER: 4,
  DEFAULT_PROJECT_NODE_ID: "PVT_kwHOA0KY4s4Boie_",
  DEFAULT_PAGE_SIZE: 100,
  DEFAULT_FIELDS_PAGE_SIZE: 50,
  DEFAULT_TIMEOUT_MS: 30_000,
  DEFAULT_CLI_COMMAND: "gh",
  DEFAULT_CLI_ARGS: ["api", "graphql", "--input", "-"] as const,
  CLI_STDIN_ENCODING: "utf-8" as BufferEncoding,
  CLI_STDOUT_ENCODING: "utf-8" as BufferEncoding,
  CLI_STDERR_ENCODING: "utf-8" as BufferEncoding,

  FIELD_NAME_STATUS: "Status",
  FIELD_NAME_PRIORITY: "Priority",
  FIELD_NAME_SIZE: "Size",
  FIELD_NAME_TITLE: "Title",

  STATUS_BACKLOG: "Backlog",
  STATUS_READY: "Ready",
  STATUS_IN_PROGRESS: "In progress",
  STATUS_IN_REVIEW: "In review",
  STATUS_DONE: "Done",

  PRIORITY_P0: "P0",
  PRIORITY_P1: "P1",
  PRIORITY_P2: "P2",
  PRIORITY_P3: "P3",

  SIZE_XS: "XS",
  SIZE_S: "S",
  SIZE_M: "M",
  SIZE_L: "L",
  SIZE_XL: "XL",

  STATUS_OPTION_IDS: {
    Backlog: "f75ad846",
    Ready: "61e4505c",
    "In progress": "47fc9ee4",
    "In review": "df73e18b",
    Done: "98236657",
  } as const,

  PRIORITY_OPTION_IDS: {
    P0: "79628723",
    P1: "0a877460",
    P2: "da944a9c",
  } as const,

  SIZE_OPTION_IDS: {
    XS: "6c6483d2",
    S: "f784b110",
    M: "7515a9f1",
    L: "817d0097",
    XL: "db339eb2",
  } as const,

  TASK_KEY_REGEX: /\[(LOOPER-[A-Z]+-\d+)\]/i,
  RETRY_AFTER_HEADER_REGEX: /retry-after:\s*(\d+)/i,
  RETRY_AFTER_SECONDS_REGEX: /retry\s+after\s+(\d+)\s*(?:seconds?|s\b)/i,
  RETRY_AFTER_MS_REGEX: /retry\s+after\s+(\d+)\s*ms/i,

  DEFAULT_MAX_RETRIES: 5,
  DEFAULT_BASE_BACKOFF_MS: 1000,
  DEFAULT_MAX_BACKOFF_MS: 60_000,
  DEFAULT_BACKOFF_FACTOR: 2,
  DEFAULT_JITTER_MIN: 0.5,
  DEFAULT_JITTER_MAX: 1.5,
  INITIAL_RETRY_ATTEMPT: 0,
  MS_PER_SECOND: 1000,

  HTTP_STATUS_OK: 200,
  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_RATE_LIMITED: 429,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
  HTTP_STATUS_BAD_GATEWAY: 502,
  HTTP_STATUS_SERVICE_UNAVAILABLE: 503,
  HTTP_STATUS_GATEWAY_TIMEOUT: 504,
  HTTP_STATUS_CLOUDFLARE_OVERLOADED: 529,

  RATE_LIMIT_ERROR_PATTERNS: [
    "rate limit",
    "rate_limited",
    "api rate limit exceeded",
    "secondary rate limit",
    "too many requests",
    "http 429",
    "429 too many requests",
  ] as const,

  TRANSIENT_NETWORK_PATTERNS: [
    "econnreset",
    "etimedout",
    "econnrefused",
    "ehostunreach",
    "enotfound",
    "enetunreach",
    "eai_again",
    "epipe",
    "socket hang up",
    "network error",
    "network is down",
    "connection reset",
    "connection refused",
    "temporary failure in name resolution",
    "could not resolve host",
    "tls handshake timeout",
    "client.timeout exceeded",
    "fetch failed",
    "und_err_connect_timeout",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "502 bad gateway",
    "503 service unavailable",
    "504 gateway timeout",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
    "http 529",
    "overloaded",
    "internal server error",
    "eof",
  ] as const,

  QUERIES: {
    GET_PROJECT_BY_USER: `
      query GetProjectByUser($owner: String!, $projectNumber: Int!, $fieldsFirst: Int!) {
        user(login: $owner) {
          projectV2(number: $projectNumber) {
            id
            title
            number
            url
            shortDescription
            public
            closed
            fields(first: $fieldsFirst) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                    description
                    color
                  }
                }
                ... on ProjectV2IterationField {
                  id
                  name
                  dataType
                }
              }
            }
          }
        }
      }
    `,
    GET_PROJECT_BY_ORG: `
      query GetProjectByOrg($owner: String!, $projectNumber: Int!, $fieldsFirst: Int!) {
        organization(login: $owner) {
          projectV2(number: $projectNumber) {
            id
            title
            number
            url
            shortDescription
            public
            closed
            fields(first: $fieldsFirst) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                    description
                    color
                  }
                }
                ... on ProjectV2IterationField {
                  id
                  name
                  dataType
                }
              }
            }
          }
        }
      }
    `,
    GET_PROJECT_ITEMS_BY_USER: `
      query GetProjectItemsByUser($owner: String!, $projectNumber: Int!, $first: Int!, $after: String) {
        user(login: $owner) {
          projectV2(number: $projectNumber) {
            items(first: $first, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                type
                status: fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                  }
                }
                priority: fieldValueByName(name: "Priority") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                  }
                }
                size: fieldValueByName(name: "Size") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                  }
                }
                content {
                  __typename
                  ... on DraftIssue {
                    id
                    title
                    body
                  }
                  ... on Issue {
                    id
                    number
                    title
                    body
                    url
                  }
                  ... on PullRequest {
                    id
                    number
                    title
                    body
                    url
                  }
                }
              }
            }
          }
        }
      }
    `,
    GET_PROJECT_ITEMS_BY_ORG: `
      query GetProjectItemsByOrg($owner: String!, $projectNumber: Int!, $first: Int!, $after: String) {
        organization(login: $owner) {
          projectV2(number: $projectNumber) {
            items(first: $first, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                type
                status: fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                  }
                }
                priority: fieldValueByName(name: "Priority") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                  }
                }
                size: fieldValueByName(name: "Size") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                  }
                }
                content {
                  __typename
                  ... on DraftIssue {
                    id
                    title
                    body
                  }
                  ... on Issue {
                    id
                    number
                    title
                    body
                    url
                  }
                  ... on PullRequest {
                    id
                    number
                    title
                    body
                    url
                  }
                }
              }
            }
          }
        }
      }
    `,
    GET_ITEM_BY_ID: `
      query GetItemById($itemId: ID!) {
        node(id: $itemId) {
          ... on ProjectV2Item {
            id
            type
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
              }
            }
            priority: fieldValueByName(name: "Priority") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
              }
            }
            size: fieldValueByName(name: "Size") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
              }
            }
            content {
              __typename
              ... on DraftIssue {
                id
                title
                body
              }
              ... on Issue {
                id
                number
                title
                body
                url
              }
              ... on PullRequest {
                id
                number
                title
                body
                url
              }
            }
          }
        }
      }
    `,
  },
  MUTATIONS: {
    UPDATE_ITEM_FIELD_VALUE: `
      mutation UpdateProjectV2ItemFieldValue($input: UpdateProjectV2ItemFieldValueInput!) {
        updateProjectV2ItemFieldValue(input: $input) {
          projectV2Item {
            id
          }
        }
      }
    `,
    ADD_DRAFT_ISSUE: `
      mutation AddProjectV2DraftIssue($input: AddProjectV2DraftIssueInput!) {
        addProjectV2DraftIssue(input: $input) {
          projectV2Item {
            id
          }
        }
      }
    `,
    DELETE_ITEM: `
      mutation DeleteProjectV2Item($input: DeleteProjectV2ItemInput!) {
        deleteProjectV2Item(input: $input) {
          deletedItemId
        }
      }
    `,
  },
} as const;

/**
 * Standard error codes for GitHub Projects operations.
 */
export const GITHUB_PROJECT_ERROR_CODES = {
  GRAPHQL_ERROR: "GITHUB_PROJECT_GRAPHQL_ERROR",
  CLI_EXECUTION_FAILED: "GITHUB_PROJECT_CLI_EXECUTION_FAILED",
  PROJECT_NOT_FOUND: "GITHUB_PROJECT_NOT_FOUND",
  FIELD_NOT_FOUND: "GITHUB_PROJECT_FIELD_NOT_FOUND",
  OPTION_NOT_FOUND: "GITHUB_PROJECT_OPTION_NOT_FOUND",
  ITEM_NOT_FOUND: "GITHUB_PROJECT_ITEM_NOT_FOUND",
  RATE_LIMITED: "GITHUB_PROJECT_RATE_LIMITED",
  INVALID_ARGUMENT: "GITHUB_PROJECT_INVALID_ARGUMENT",
  NETWORK_ERROR: "GITHUB_PROJECT_NETWORK_ERROR",
  TIMEOUT: "GITHUB_PROJECT_TIMEOUT",
} as const;

export type GitHubProjectErrorCode =
  (typeof GITHUB_PROJECT_ERROR_CODES)[keyof typeof GITHUB_PROJECT_ERROR_CODES];

/**
 * Custom error class for GitHub Projects V2 operations.
 */
export class GitHubProjectError extends Error {
  public readonly code: GitHubProjectErrorCode;
  public readonly details?: unknown;
  public readonly retryAfterMs?: number;

  constructor(
    message: string,
    code: GitHubProjectErrorCode,
    details?: unknown,
    cause?: unknown,
    retryAfterMs?: number,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "GitHubProjectError";
    this.code = code;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
  }

  public isRateLimited(): boolean {
    return (
      this.code === GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED ||
      GITHUB_PROJECT_CONSTANTS.RATE_LIMIT_ERROR_PATTERNS.some((pattern) =>
        this.message.toLowerCase().includes(pattern),
      )
    );
  }

  public isTransientNetworkError(): boolean {
    return (
      this.code === GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR ||
      this.code === GITHUB_PROJECT_ERROR_CODES.TIMEOUT ||
      GITHUB_PROJECT_CONSTANTS.TRANSIENT_NETWORK_PATTERNS.some((pattern) =>
        this.message.toLowerCase().includes(pattern),
      )
    );
  }

  public isTransient(): boolean {
    return this.isRateLimited() || this.isTransientNetworkError();
  }

  public isRetryable(): boolean {
    return this.isTransient();
  }
}

/**
 * Checks whether an error is caused by rate limiting.
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof GitHubProjectError) {
    return error.isRateLimited();
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      GITHUB_PROJECT_CONSTANTS.RATE_LIMIT_ERROR_PATTERNS.some((pattern) =>
        msg.includes(pattern),
      )
    ) {
      return true;
    }
  }
  if (typeof error === "string") {
    const lower = error.toLowerCase();
    return GITHUB_PROJECT_CONSTANTS.RATE_LIMIT_ERROR_PATTERNS.some((pattern) =>
      lower.includes(pattern),
    );
  }
  if (error !== null && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (obj.code === GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED) {
      return true;
    }
    const status = obj.status ?? obj.statusCode;
    if (status === GITHUB_PROJECT_CONSTANTS.HTTP_STATUS_RATE_LIMITED) {
      return true;
    }
    if (obj.type === "RATE_LIMITED") {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether an error is caused by a transient network issue or server glitch.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof GitHubProjectError) {
    return error.isTransientNetworkError();
  }
  if (error instanceof Error) {
    const sysCode = (error as { code?: string }).code;
    if (
      typeof sysCode === "string" &&
      GITHUB_PROJECT_CONSTANTS.TRANSIENT_NETWORK_PATTERNS.some((pattern) =>
        sysCode.toLowerCase().includes(pattern),
      )
    ) {
      return true;
    }
    const message = error.message.toLowerCase();
    if (
      GITHUB_PROJECT_CONSTANTS.TRANSIENT_NETWORK_PATTERNS.some((pattern) =>
        message.includes(pattern),
      )
    ) {
      return true;
    }
  }
  if (typeof error === "string") {
    const lower = error.toLowerCase();
    return GITHUB_PROJECT_CONSTANTS.TRANSIENT_NETWORK_PATTERNS.some((pattern) =>
      lower.includes(pattern),
    );
  }
  if (error !== null && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (
      obj.code === GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR ||
      obj.code === GITHUB_PROJECT_ERROR_CODES.TIMEOUT
    ) {
      return true;
    }
    const status = obj.status ?? obj.statusCode;
    if (
      status === GITHUB_PROJECT_CONSTANTS.HTTP_STATUS_BAD_GATEWAY ||
      status === GITHUB_PROJECT_CONSTANTS.HTTP_STATUS_SERVICE_UNAVAILABLE ||
      status === GITHUB_PROJECT_CONSTANTS.HTTP_STATUS_GATEWAY_TIMEOUT ||
      status === GITHUB_PROJECT_CONSTANTS.HTTP_STATUS_CLOUDFLARE_OVERLOADED ||
      status === GITHUB_PROJECT_CONSTANTS.HTTP_STATUS_INTERNAL_SERVER_ERROR
    ) {
      return true;
    }
    if (
      obj.type === "SERVICE_UNAVAILABLE" ||
      obj.type === "UNAVAILABLE" ||
      obj.type === "TIMEOUT"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether an error is eligible for retry (rate limit or transient network error).
 */
export function isRetryableError(error: unknown): boolean {
  return isRateLimitError(error) || isTransientNetworkError(error);
}

/**
 * Extracts retry-after duration in milliseconds from an error message, headers, or metadata.
 */
export function extractRetryAfterMs(error: unknown): number | null {
  if (error === null || error === undefined) {
    return null;
  }

  if (error instanceof GitHubProjectError && typeof error.retryAfterMs === "number") {
    return error.retryAfterMs;
  }

  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (typeof obj.retryAfterMs === "number" && obj.retryAfterMs >= 0) {
      return obj.retryAfterMs;
    }
    if (typeof obj.retryAfter === "number" && obj.retryAfter >= 0) {
      return obj.retryAfter * GITHUB_PROJECT_CONSTANTS.MS_PER_SECOND;
    }
    if (obj.details && typeof obj.details === "object") {
      const details = obj.details as Record<string, unknown>;
      if (typeof details.retryAfterMs === "number" && details.retryAfterMs >= 0) {
        return details.retryAfterMs;
      }
      if (typeof details.retryAfter === "number" && details.retryAfter >= 0) {
        return details.retryAfter * GITHUB_PROJECT_CONSTANTS.MS_PER_SECOND;
      }
      if (details.headers && typeof details.headers === "object") {
        const headers = details.headers as Record<string, unknown>;
        const headerVal = headers["retry-after"] ?? headers["Retry-After"];
        if (typeof headerVal === "string" || typeof headerVal === "number") {
          const parsed = Number(headerVal);
          if (!Number.isNaN(parsed) && parsed >= 0) {
            return parsed * GITHUB_PROJECT_CONSTANTS.MS_PER_SECOND;
          }
        }
      }
    }
  }

  const textToScan =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (textToScan) {
    const msMatch = textToScan.match(GITHUB_PROJECT_CONSTANTS.RETRY_AFTER_MS_REGEX);
    if (msMatch?.[1]) {
      const parsed = Number(msMatch[1]);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    const secMatch =
      textToScan.match(GITHUB_PROJECT_CONSTANTS.RETRY_AFTER_SECONDS_REGEX) ??
      textToScan.match(GITHUB_PROJECT_CONSTANTS.RETRY_AFTER_HEADER_REGEX);
    if (secMatch?.[1]) {
      const parsed = Number(secMatch[1]);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        return parsed * GITHUB_PROJECT_CONSTANTS.MS_PER_SECOND;
      }
    }
  }

  return null;
}

/**
 * Options configuring exponential backoff delay calculation.
 */
export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitterMin?: number;
  jitterMax?: number;
  useJitter?: boolean;
}

/**
 * Calculates exponential backoff delay with jitter.
 *
 * Formula: min(maxDelay, baseDelay * (factor ^ attempt)) * Uniform(jitterMin, jitterMax)
 */
export function calculateExponentialBackoffDelay(
  attempt: number,
  options?: BackoffOptions,
): number {
  const baseDelayMs =
    options?.baseDelayMs ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_BASE_BACKOFF_MS;
  const maxDelayMs =
    options?.maxDelayMs ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_MAX_BACKOFF_MS;
  const backoffFactor =
    options?.backoffFactor ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_BACKOFF_FACTOR;
  const jitterMin =
    options?.jitterMin ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_JITTER_MIN;
  const jitterMax =
    options?.jitterMax ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_JITTER_MAX;
  const useJitter = options?.useJitter ?? true;

  const exp = Math.max(0, attempt);
  const rawDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(backoffFactor, exp));
  const jitter = useJitter
    ? jitterMin + Math.random() * (jitterMax - jitterMin)
    : 1;

  return Math.round(rawDelay * jitter);
}

/**
 * Configuration options for retrying operations with backoff.
 */
export interface RetryOptions extends BackoffOptions {
  maxRetries?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  sleepFn?: (delayMs: number) => Promise<void>;
}

/**
 * Executes an asynchronous operation with exponential backoff retry on transient errors.
 */
export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries =
    options?.maxRetries ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_MAX_RETRIES;
  const sleepFn =
    options?.sleepFn ??
    (async (ms: number): Promise<void> => {
      if (ms <= 0) return;
      return new Promise((resolve) => setTimeout(resolve, ms));
    });
  const shouldRetry =
    options?.shouldRetry ??
    ((err: unknown, attempt: number): boolean =>
      attempt < maxRetries && isRetryableError(err));

  let attempt = GITHUB_PROJECT_CONSTANTS.INITIAL_RETRY_ATTEMPT;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!shouldRetry(error, attempt) || attempt >= maxRetries) {
        throw error;
      }

      const retryAfterMs = extractRetryAfterMs(error);
      const delayMs =
        retryAfterMs !== null && retryAfterMs > 0
          ? Math.min(
              options?.maxDelayMs ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_MAX_BACKOFF_MS,
              retryAfterMs,
            )
          : calculateExponentialBackoffDelay(attempt, options);

      attempt += 1;

      if (options?.onRetry) {
        options.onRetry(error, attempt, delayMs);
      }

      await sleepFn(delayMs);
    }
  }
}

/**
 * Extracts a LOOPER task key from an issue/draft title (e.g., "[LOOPER-INT-002]").
 */
export function extractTaskKey(title: string): string | null {
  const match = title.match(GITHUB_PROJECT_CONSTANTS.TASK_KEY_REGEX);
  const matchedGroup = match?.[1];
  return matchedGroup ? matchedGroup.toUpperCase() : null;
}

export type ProjectOwnerType = "user" | "organization";

/**
 * Standard single-select option values for GitHub Project #4.
 */
export const PROJECT_STATUS_VALUES = [
  "Backlog",
  "Ready",
  "In progress",
  "In review",
  "Done",
] as const;

export type StandardProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

export type ProjectItemStatus =
  | StandardProjectStatus
  | "backlog"
  | "ready"
  | "in progress"
  | "in_progress"
  | "in-progress"
  | "in review"
  | "in_review"
  | "in-review"
  | "done";

export const PROJECT_PRIORITY_VALUES = [
  "P0",
  "P1",
  "P2",
  "P3",
] as const;

export type StandardProjectPriority = (typeof PROJECT_PRIORITY_VALUES)[number];

export type ProjectItemPriority =
  | StandardProjectPriority
  | "p0"
  | "p1"
  | "p2"
  | "p3";

export const PROJECT_SIZE_VALUES = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
] as const;

export type StandardProjectSize = (typeof PROJECT_SIZE_VALUES)[number];

export type ProjectItemSize =
  | StandardProjectSize
  | "xs"
  | "s"
  | "m"
  | "l"
  | "xl"
  | number;

export interface ProjectFieldMutationResult<T = unknown> {
  itemId: string;
  fieldId: string;
  value: T;
  optionId?: string;
}

export interface StatusMutationResult extends ProjectFieldMutationResult<StandardProjectStatus> {
  status: StandardProjectStatus;
}

export interface PriorityMutationResult extends ProjectFieldMutationResult<StandardProjectPriority> {
  priority: StandardProjectPriority;
}

export interface SizeMutationResult extends ProjectFieldMutationResult<StandardProjectSize | number> {
  size: StandardProjectSize | number;
}

export interface UpdateItemFieldsOptions {
  status?: ProjectItemStatus;
  priority?: ProjectItemPriority;
  size?: ProjectItemSize;
}

export interface UpdateItemFieldsResult {
  itemId: string;
  status?: StatusMutationResult;
  priority?: PriorityMutationResult;
  size?: SizeMutationResult;
}

export interface ProjectV2SingleSelectOption {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

export interface ProjectV2Field {
  id: string;
  name: string;
  dataType: string;
  options?: ProjectV2SingleSelectOption[];
}

export interface ProjectV2FieldValue {
  singleSelectOptionId?: string;
  text?: string;
  number?: number;
  date?: string;
}

export interface ProjectV2DraftIssueContent {
  __typename: "DraftIssue";
  id?: string;
  title: string;
  body: string;
}

export interface ProjectV2IssueContent {
  __typename: "Issue";
  id?: string;
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface ProjectV2PullRequestContent {
  __typename: "PullRequest";
  id?: string;
  number: number;
  title: string;
  body: string;
  url: string;
}

export type ProjectV2ItemContent =
  | ProjectV2DraftIssueContent
  | ProjectV2IssueContent
  | ProjectV2PullRequestContent;

export interface ProjectV2Item {
  id: string;
  type: string;
  status?: string;
  statusOptionId?: string;
  priority?: string;
  priorityOptionId?: string;
  size?: string;
  sizeOptionId?: string;
  content?: ProjectV2ItemContent;
  rawFields?: Record<string, unknown>;
}

export interface ProjectV2Details {
  id: string;
  title: string;
  number: number;
  url?: string;
  shortDescription?: string;
  public?: boolean;
  closed?: boolean;
  owner: {
    login: string;
    type: ProjectOwnerType;
  };
  fields: ProjectV2Field[];
}

export interface GraphQLGraphQLError {
  message: string;
  type?: string;
  path?: Array<string | number>;
  locations?: Array<{ line: number; column: number }>;
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: GraphQLGraphQLError[];
}

/**
 * Functional executor contract for GraphQL queries and mutations.
 */
export type GraphQLExecutor = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<unknown>;

export interface GitHubProjectConfig {
  owner?: string;
  ownerType?: ProjectOwnerType;
  projectNumber?: number;
  projectId?: string;
  timeoutMs?: number;
  ghCliPath?: string;
  executor?: GraphQLExecutor;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitterMin?: number;
  jitterMax?: number;
  useJitter?: boolean;
  retry?: RetryOptions | boolean;
  sleepFn?: (delayMs: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

interface RawFieldNode {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{
    id: string;
    name: string;
    description?: string;
    color?: string;
  }>;
}

interface RawProjectDetails {
  id: string;
  title: string;
  number: number;
  url?: string;
  shortDescription?: string;
  public?: boolean;
  closed?: boolean;
  fields?: {
    nodes?: RawFieldNode[];
  };
}

interface RawSingleSelectValue {
  name: string;
  optionId?: string;
}

interface RawContentNode {
  __typename: "DraftIssue" | "Issue" | "PullRequest";
  id?: string;
  number?: number;
  title?: string;
  body?: string;
  url?: string;
}

interface RawProjectV2ItemNode {
  id: string;
  type: string;
  status?: RawSingleSelectValue | null;
  priority?: RawSingleSelectValue | null;
  size?: RawSingleSelectValue | null;
  content?: RawContentNode | null;
}

interface RawItemsContainer {
  items?: {
    pageInfo?: {
      hasNextPage?: boolean;
      endCursor?: string;
    };
    nodes?: RawProjectV2ItemNode[];
  };
}

/**
 * Normalizes a raw GraphQL ProjectV2Item node into a clean ProjectV2Item model.
 */
export function normalizeProjectV2Item(raw: RawProjectV2ItemNode): ProjectV2Item {
  let content: ProjectV2ItemContent | undefined = undefined;
  if (raw.content) {
    if (raw.content.__typename === "DraftIssue") {
      content = {
        __typename: "DraftIssue",
        id: raw.content.id,
        title: raw.content.title ?? "",
        body: raw.content.body ?? "",
      };
    } else if (raw.content.__typename === "Issue") {
      content = {
        __typename: "Issue",
        id: raw.content.id,
        number: raw.content.number ?? 0,
        title: raw.content.title ?? "",
        body: raw.content.body ?? "",
        url: raw.content.url ?? "",
      };
    } else if (raw.content.__typename === "PullRequest") {
      content = {
        __typename: "PullRequest",
        id: raw.content.id,
        number: raw.content.number ?? 0,
        title: raw.content.title ?? "",
        body: raw.content.body ?? "",
        url: raw.content.url ?? "",
      };
    }
  }

  return {
    id: raw.id,
    type: raw.type,
    status: raw.status?.name,
    statusOptionId: raw.status?.optionId,
    priority: raw.priority?.name,
    priorityOptionId: raw.priority?.optionId,
    size: raw.size?.name,
    sizeOptionId: raw.size?.optionId,
    content,
    rawFields: raw as unknown as Record<string, unknown>,
  };
}

/**
 * Creates the default GraphQL executor powered by `gh api graphql --input -`.
 */
export function createDefaultGhCliExecutor(options?: {
  ghCliPath?: string;
  timeoutMs?: number;
}): GraphQLExecutor {
  const cliPath = options?.ghCliPath ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_CLI_COMMAND;
  const timeoutMs = options?.timeoutMs ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_TIMEOUT_MS;

  return async (
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        query,
        variables: variables ?? {},
      });

      const proc = spawn(
        cliPath,
        [...GITHUB_PROJECT_CONSTANTS.DEFAULT_CLI_ARGS],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, timeoutMs);

      proc.stdout.setEncoding(GITHUB_PROJECT_CONSTANTS.CLI_STDOUT_ENCODING);
      proc.stderr.setEncoding(GITHUB_PROJECT_CONSTANTS.CLI_STDERR_ENCODING);

      proc.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });

      proc.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        const isNetwork = isTransientNetworkError(err);
        reject(
          new GitHubProjectError(
            `Failed to spawn ${cliPath}: ${err.message}`,
            isNetwork
              ? GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR
              : GITHUB_PROJECT_ERROR_CODES.CLI_EXECUTION_FAILED,
            { cliPath, error: err.message },
            err,
          ),
        );
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);

        if (timedOut) {
          reject(
            new GitHubProjectError(
              `gh GraphQL operation timed out after ${timeoutMs}ms`,
              GITHUB_PROJECT_ERROR_CODES.TIMEOUT,
              { timeoutMs },
            ),
          );
          return;
        }

        const combinedOutput = `${stdout}\n${stderr}`.toLowerCase();
        for (const pattern of GITHUB_PROJECT_CONSTANTS.RATE_LIMIT_ERROR_PATTERNS) {
          if (combinedOutput.includes(pattern)) {
            const retryAfterMs = extractRetryAfterMs(`${stderr}\n${stdout}`);
            reject(
              new GitHubProjectError(
                `GitHub API rate limit exceeded: ${stderr || stdout}`,
                GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED,
                { stdout, stderr, code },
                undefined,
                retryAfterMs ?? undefined,
              ),
            );
            return;
          }
        }

        for (const pattern of GITHUB_PROJECT_CONSTANTS.TRANSIENT_NETWORK_PATTERNS) {
          if (combinedOutput.includes(pattern)) {
            reject(
              new GitHubProjectError(
                `GitHub API transient network error: ${stderr || stdout}`,
                GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR,
                { stdout, stderr, code },
              ),
            );
            return;
          }
        }

        if (code !== 0 && !stdout.trim()) {
          reject(
            new GitHubProjectError(
              `gh CLI exited with code ${code ?? "null"}: ${stderr.trim()}`,
              GITHUB_PROJECT_ERROR_CODES.CLI_EXECUTION_FAILED,
              { exitCode: code, stderr, stdout },
            ),
          );
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as GraphQLResponse<unknown>;
          if (parsed.errors && parsed.errors.length > 0) {
            const firstError = parsed.errors[0];
            const errMsg = firstError?.message ?? "Unknown GraphQL error";
            const errType = firstError?.type;

            for (const pattern of GITHUB_PROJECT_CONSTANTS.RATE_LIMIT_ERROR_PATTERNS) {
              if (errMsg.toLowerCase().includes(pattern) || errType === "RATE_LIMITED") {
                const retryAfterMs = extractRetryAfterMs(errMsg);
                reject(
                  new GitHubProjectError(
                    `GitHub API rate limit exceeded: ${errMsg}`,
                    GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED,
                    parsed.errors,
                    undefined,
                    retryAfterMs ?? undefined,
                  ),
                );
                return;
              }
            }

            for (const pattern of GITHUB_PROJECT_CONSTANTS.TRANSIENT_NETWORK_PATTERNS) {
              if (
                errMsg.toLowerCase().includes(pattern) ||
                errType === "SERVICE_UNAVAILABLE" ||
                errType === "UNAVAILABLE"
              ) {
                reject(
                  new GitHubProjectError(
                    `GitHub API transient network error: ${errMsg}`,
                    GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR,
                    parsed.errors,
                  ),
                );
                return;
              }
            }

            if (
              errType === "NOT_FOUND" ||
              errMsg.toLowerCase().includes("could not resolve")
            ) {
              reject(
                new GitHubProjectError(
                  `GitHub Projects resource not found: ${errMsg}`,
                  GITHUB_PROJECT_ERROR_CODES.PROJECT_NOT_FOUND,
                  parsed.errors,
                ),
              );
              return;
            }

            reject(
              new GitHubProjectError(
                `GraphQL execution error: ${errMsg}`,
                GITHUB_PROJECT_ERROR_CODES.GRAPHQL_ERROR,
                parsed.errors,
              ),
            );
            return;
          }

          if (parsed.data === undefined) {
            reject(
              new GitHubProjectError(
                "GraphQL response did not contain data field",
                GITHUB_PROJECT_ERROR_CODES.GRAPHQL_ERROR,
                { parsed },
              ),
            );
            return;
          }

          resolve(parsed.data);
        } catch (parseErr) {
          reject(
            new GitHubProjectError(
              `Failed to parse GraphQL response JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
              GITHUB_PROJECT_ERROR_CODES.CLI_EXECUTION_FAILED,
              { stdout, stderr },
              parseErr,
            ),
          );
        }
      });

      proc.stdin.write(payload, GITHUB_PROJECT_CONSTANTS.CLI_STDIN_ENCODING);
      proc.stdin.end();
    });
  };
}

/**
 * Service orchestrating GitHub Projects V2 GraphQL API operations.
 */
export class GitHubProjectService {
  private readonly config: {
    owner: string;
    ownerType: ProjectOwnerType;
    projectNumber: number;
    projectId?: string;
    ghCliPath: string;
    timeoutMs: number;
  };
  private readonly executor: GraphQLExecutor;
  private readonly retryConfig: Required<
    Omit<RetryOptions, "shouldRetry" | "onRetry">
  > & {
    shouldRetry?: (error: unknown, attempt: number) => boolean;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  };
  private cachedProjectDetails: ProjectV2Details | null = null;
  private cachedProjectId: string | null = null;
  private fieldsCache: ProjectV2Field[] | null = null;

  constructor(config?: GitHubProjectConfig) {
    this.config = {
      owner: config?.owner ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_OWNER,
      ownerType: config?.ownerType ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_OWNER_TYPE,
      projectNumber: config?.projectNumber ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_PROJECT_NUMBER,
      projectId: config?.projectId,
      ghCliPath: config?.ghCliPath ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_CLI_COMMAND,
      timeoutMs: config?.timeoutMs ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_TIMEOUT_MS,
    };

    const isTestEnv = process.env.NODE_ENV === "test";
    const retryOption = config?.retry;
    const retryDisabled = retryOption === false || config?.maxRetries === 0;
    const retryConfigObj = typeof retryOption === "object" ? retryOption : {};

    const maxRetries = retryDisabled
      ? 0
      : (config?.maxRetries ??
        retryConfigObj.maxRetries ??
        GITHUB_PROJECT_CONSTANTS.DEFAULT_MAX_RETRIES);

    const baseDelayMs =
      config?.baseDelayMs ??
      retryConfigObj.baseDelayMs ??
      GITHUB_PROJECT_CONSTANTS.DEFAULT_BASE_BACKOFF_MS;

    const maxDelayMs =
      config?.maxDelayMs ??
      retryConfigObj.maxDelayMs ??
      GITHUB_PROJECT_CONSTANTS.DEFAULT_MAX_BACKOFF_MS;

    const backoffFactor =
      config?.backoffFactor ??
      retryConfigObj.backoffFactor ??
      GITHUB_PROJECT_CONSTANTS.DEFAULT_BACKOFF_FACTOR;

    const jitterMin =
      config?.jitterMin ??
      retryConfigObj.jitterMin ??
      GITHUB_PROJECT_CONSTANTS.DEFAULT_JITTER_MIN;

    const jitterMax =
      config?.jitterMax ??
      retryConfigObj.jitterMax ??
      GITHUB_PROJECT_CONSTANTS.DEFAULT_JITTER_MAX;

    const useJitter =
      config?.useJitter ??
      retryConfigObj.useJitter ??
      true;

    const onRetry = config?.onRetry ?? retryConfigObj.onRetry;

    const defaultSleep =
      isTestEnv &&
      !config?.sleepFn &&
      !retryConfigObj.sleepFn &&
      config?.baseDelayMs === undefined &&
      retryConfigObj.baseDelayMs === undefined
        ? async (): Promise<void> => {}
        : async (delay: number): Promise<void> => {
            if (delay <= 0) return;
            return new Promise((resolve) => setTimeout(resolve, delay));
          };

    const sleepFn = config?.sleepFn ?? retryConfigObj.sleepFn ?? defaultSleep;

    this.retryConfig = {
      maxRetries,
      baseDelayMs,
      maxDelayMs,
      backoffFactor,
      jitterMin,
      jitterMax,
      useJitter,
      sleepFn,
      onRetry,
      shouldRetry: retryConfigObj.shouldRetry,
    };

    this.cachedProjectId = this.config.projectId ?? null;
    this.executor =
      config?.executor ??
      createDefaultGhCliExecutor({
        ghCliPath: this.config.ghCliPath,
        timeoutMs: this.config.timeoutMs,
      });
  }

  public getConfig(): Readonly<GitHubProjectConfig> {
    return {
      ...this.config,
      maxRetries: this.retryConfig.maxRetries,
      baseDelayMs: this.retryConfig.baseDelayMs,
      maxDelayMs: this.retryConfig.maxDelayMs,
      backoffFactor: this.retryConfig.backoffFactor,
      jitterMin: this.retryConfig.jitterMin,
      jitterMax: this.retryConfig.jitterMax,
      useJitter: this.retryConfig.useJitter,
      sleepFn: this.retryConfig.sleepFn,
      onRetry: this.retryConfig.onRetry,
    };
  }

  public getRetryConfig(): Readonly<
    Required<Omit<RetryOptions, "shouldRetry" | "onRetry">> & {
      shouldRetry?: (error: unknown, attempt: number) => boolean;
      onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
    }
  > {
    return { ...this.retryConfig };
  }

  public getExecutor(): GraphQLExecutor {
    return this.executor;
  }

  public extractTaskKey(title: string): string | null {
    return extractTaskKey(title);
  }

  public clearCache(): void {
    this.cachedProjectDetails = null;
    this.cachedProjectId = this.config.projectId ?? null;
    this.fieldsCache = null;
  }

  /**
   * Executes a GraphQL query or mutation, validating and unwrapping the result
   * with automatic exponential backoff retries on rate limits and network transient errors.
   */
  public async executeGraphQL<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const singleExecution = async (): Promise<T> => {
      const rawResult = (await this.executor(query, variables)) as
        | GraphQLResponse<T>
        | T;

      if (rawResult !== null && typeof rawResult === "object") {
        const maybeResponse = rawResult as GraphQLResponse<T>;
        if (maybeResponse.errors && maybeResponse.errors.length > 0) {
          const firstError = maybeResponse.errors[0];
          const errMsg = firstError?.message ?? "GraphQL execution error";
          const errType = firstError?.type;

          const isRate =
            errType === "RATE_LIMITED" ||
            isRateLimitError(errMsg);
          if (isRate) {
            const retryAfterMs = extractRetryAfterMs(errMsg);
            throw new GitHubProjectError(
              `GitHub API rate limit exceeded: ${errMsg}`,
              GITHUB_PROJECT_ERROR_CODES.RATE_LIMITED,
              maybeResponse.errors,
              undefined,
              retryAfterMs ?? undefined,
            );
          }

          const isNet =
            errType === "SERVICE_UNAVAILABLE" ||
            errType === "UNAVAILABLE" ||
            isTransientNetworkError(errMsg);
          if (isNet) {
            throw new GitHubProjectError(
              `GitHub API transient network error: ${errMsg}`,
              GITHUB_PROJECT_ERROR_CODES.NETWORK_ERROR,
              maybeResponse.errors,
            );
          }

          if (
            errType === "NOT_FOUND" ||
            errMsg.toLowerCase().includes("could not resolve")
          ) {
            throw new GitHubProjectError(
              `GitHub Projects resource not found: ${errMsg}`,
              GITHUB_PROJECT_ERROR_CODES.PROJECT_NOT_FOUND,
              maybeResponse.errors,
            );
          }

          throw new GitHubProjectError(
            `GraphQL error: ${errMsg}`,
            GITHUB_PROJECT_ERROR_CODES.GRAPHQL_ERROR,
            maybeResponse.errors,
          );
        }
        if ("data" in maybeResponse && maybeResponse.data !== undefined) {
          return maybeResponse.data;
        }
      }

      return rawResult as T;
    };

    return executeWithRetry(() => singleExecution(), this.retryConfig);
  }

  /**
   * Resolves the Project Node ID (from config, cache, or GraphQL query).
   */
  public async getProjectId(): Promise<string> {
    if (this.config.projectId) {
      return this.config.projectId;
    }
    if (this.cachedProjectId) {
      return this.cachedProjectId;
    }
    const details = await this.getProjectDetails();
    return details.id;
  }

  /**
   * Fetches metadata, configuration, and fields for the target GitHub Project V2.
   */
  public async getProjectDetails(forceRefresh = false): Promise<ProjectV2Details> {
    if (!forceRefresh && this.cachedProjectDetails) {
      return this.cachedProjectDetails;
    }

    const isOrg = this.config.ownerType === "organization";
    const query = isOrg
      ? GITHUB_PROJECT_CONSTANTS.QUERIES.GET_PROJECT_BY_ORG
      : GITHUB_PROJECT_CONSTANTS.QUERIES.GET_PROJECT_BY_USER;

    const variables = {
      owner: this.config.owner,
      projectNumber: this.config.projectNumber,
      fieldsFirst: GITHUB_PROJECT_CONSTANTS.DEFAULT_FIELDS_PAGE_SIZE,
    };

    interface ProjectQueryResponse {
      user?: { projectV2?: RawProjectDetails };
      organization?: { projectV2?: RawProjectDetails };
    }

    const data = await this.executeGraphQL<ProjectQueryResponse>(query, variables);
    const rawProject = isOrg ? data.organization?.projectV2 : data.user?.projectV2;

    if (!rawProject) {
      throw new GitHubProjectError(
        `Project #${this.config.projectNumber} not found for owner '${this.config.owner}' (${this.config.ownerType})`,
        GITHUB_PROJECT_ERROR_CODES.PROJECT_NOT_FOUND,
        {
          owner: this.config.owner,
          projectNumber: this.config.projectNumber,
          ownerType: this.config.ownerType,
        },
      );
    }

    const fields: ProjectV2Field[] = (rawProject.fields?.nodes ?? []).map((node) => ({
      id: node.id,
      name: node.name,
      dataType: node.dataType,
      options: node.options?.map((opt) => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        color: opt.color,
      })),
    }));

    const details: ProjectV2Details = {
      id: rawProject.id,
      title: rawProject.title,
      number: rawProject.number,
      url: rawProject.url,
      shortDescription: rawProject.shortDescription,
      public: rawProject.public,
      closed: rawProject.closed,
      owner: {
        login: this.config.owner,
        type: this.config.ownerType,
      },
      fields,
    };

    this.cachedProjectDetails = details;
    this.cachedProjectId = details.id;
    this.fieldsCache = fields;

    return details;
  }

  /**
   * Retrieves all defined fields and options for the project.
   */
  public async getFields(forceRefresh = false): Promise<ProjectV2Field[]> {
    if (!forceRefresh && this.fieldsCache) {
      return this.fieldsCache;
    }
    const details = await this.getProjectDetails(forceRefresh);
    return details.fields;
  }

  /**
   * Finds a field definition by its name (case-insensitive).
   */
  public async getFieldByName(name: string): Promise<ProjectV2Field | undefined> {
    const fields = await this.getFields();
    const targetName = name.trim().toLowerCase();
    return fields.find((f) => f.name.toLowerCase() === targetName);
  }

  /**
   * Finds a field definition by its unique GraphQL ID.
   */
  public async getFieldById(id: string): Promise<ProjectV2Field | undefined> {
    const fields = await this.getFields();
    return fields.find((f) => f.id === id);
  }

  /**
   * Finds a single-select option for a specific field by option name (case-insensitive) or option ID.
   */
  public async getSingleSelectOption(
    fieldName: string,
    optionNameOrId: string,
  ): Promise<ProjectV2SingleSelectOption | undefined> {
    const field = await this.getFieldByName(fieldName);
    if (!field || !field.options) {
      return undefined;
    }
    const target = optionNameOrId.trim().toLowerCase();
    const normalizedTarget = target.replace(/[_\s-]+/g, " ");

    return field.options.find((opt) => {
      const optLower = opt.name.trim().toLowerCase();
      const optNormalized = optLower.replace(/[_\s-]+/g, " ");
      return (
        optLower === target ||
        optNormalized === normalizedTarget ||
        opt.id.toLowerCase() === target
      );
    });
  }

  /**
   * Retrieves a paginated slice of items in the GitHub Project V2.
   */
  public async getItems(options?: {
    first?: number;
    after?: string;
  }): Promise<{
    items: ProjectV2Item[];
    hasNextPage: boolean;
    endCursor?: string;
  }> {
    const isOrg = this.config.ownerType === "organization";
    const query = isOrg
      ? GITHUB_PROJECT_CONSTANTS.QUERIES.GET_PROJECT_ITEMS_BY_ORG
      : GITHUB_PROJECT_CONSTANTS.QUERIES.GET_PROJECT_ITEMS_BY_USER;

    const pageSize = options?.first ?? GITHUB_PROJECT_CONSTANTS.DEFAULT_PAGE_SIZE;
    const variables = {
      owner: this.config.owner,
      projectNumber: this.config.projectNumber,
      first: pageSize,
      after: options?.after ?? null,
    };

    interface ItemsQueryResponse {
      user?: { projectV2?: RawItemsContainer };
      organization?: { projectV2?: RawItemsContainer };
    }

    const data = await this.executeGraphQL<ItemsQueryResponse>(query, variables);
    const container = isOrg ? data.organization?.projectV2 : data.user?.projectV2;

    if (!container || !container.items) {
      throw new GitHubProjectError(
        `Failed to retrieve items for project #${this.config.projectNumber}`,
        GITHUB_PROJECT_ERROR_CODES.PROJECT_NOT_FOUND,
        { owner: this.config.owner, projectNumber: this.config.projectNumber },
      );
    }

    const nodes = container.items.nodes ?? [];
    const items: ProjectV2Item[] = nodes.map((node) => normalizeProjectV2Item(node));

    return {
      items,
      hasNextPage: Boolean(container.items.pageInfo?.hasNextPage),
      endCursor: container.items.pageInfo?.endCursor,
    };
  }

  /**
   * Retrieves all items from the project by following pagination cursors.
   */
  public async getAllItems(maxItems?: number): Promise<ProjectV2Item[]> {
    const allItems: ProjectV2Item[] = [];
    let cursor: string | undefined = undefined;
    let hasNext = true;

    while (hasNext) {
      const page = await this.getItems({
        first: GITHUB_PROJECT_CONSTANTS.DEFAULT_PAGE_SIZE,
        after: cursor,
      });

      allItems.push(...page.items);

      if (maxItems !== undefined && allItems.length >= maxItems) {
        return allItems.slice(0, maxItems);
      }

      hasNext = page.hasNextPage;
      cursor = page.endCursor;
      if (!cursor) {
        break;
      }
    }

    return allItems;
  }

  /**
   * Retrieves a single project item by its Node ID.
   */
  public async getItemById(itemId: string): Promise<ProjectV2Item | undefined> {
    interface NodeQueryResponse {
      node?: RawProjectV2ItemNode | null;
    }

    const data = await this.executeGraphQL<NodeQueryResponse>(
      GITHUB_PROJECT_CONSTANTS.QUERIES.GET_ITEM_BY_ID,
      { itemId },
    );

    if (!data.node) {
      return undefined;
    }

    return normalizeProjectV2Item(data.node);
  }

  /**
   * Searches for a project item by matching its LOOPER task key.
   */
  public async findItemByTaskKey(taskKey: string): Promise<ProjectV2Item | undefined> {
    const normalizedKey = taskKey.replace(/^\[|\]$/g, "").trim().toUpperCase();
    const allItems = await this.getAllItems();

    return allItems.find((item) => {
      const title = item.content?.title;
      if (!title) return false;
      const extracted = this.extractTaskKey(title);
      if (extracted && extracted === normalizedKey) {
        return true;
      }
      return title.toUpperCase().includes(normalizedKey);
    });
  }

  /**
   * Searches for a project item whose title contains the given substring.
   */
  public async findItemByTitle(titleSubstring: string): Promise<ProjectV2Item | undefined> {
    const query = titleSubstring.trim().toLowerCase();
    const allItems = await this.getAllItems();
    return allItems.find((item) => {
      const title = item.content?.title;
      return title ? title.toLowerCase().includes(query) : false;
    });
  }

  /**
   * Mutates a field value on a target project item.
   */
  public async updateFieldValue(
    itemId: string,
    fieldId: string,
    value: ProjectV2FieldValue,
  ): Promise<{ itemId: string }> {
    const projectId = await this.getProjectId();

    interface UpdateFieldResponse {
      updateProjectV2ItemFieldValue: {
        projectV2Item: {
          id: string;
        };
      };
    }

    const data = await this.executeGraphQL<UpdateFieldResponse>(
      GITHUB_PROJECT_CONSTANTS.MUTATIONS.UPDATE_ITEM_FIELD_VALUE,
      {
        input: {
          projectId,
          itemId,
          fieldId,
          value,
        },
      },
    );

    return { itemId: data.updateProjectV2ItemFieldValue.projectV2Item.id };
  }

  /**
   * Creates a new draft issue item in the project.
   */
  public async addDraftIssue(
    title: string,
    body?: string,
  ): Promise<{ itemId: string }> {
    const projectId = await this.getProjectId();

    interface AddDraftResponse {
      addProjectV2DraftIssue: {
        projectV2Item: {
          id: string;
        };
      };
    }

    const data = await this.executeGraphQL<AddDraftResponse>(
      GITHUB_PROJECT_CONSTANTS.MUTATIONS.ADD_DRAFT_ISSUE,
      {
        input: {
          projectId,
          title,
          body: body ?? "",
        },
      },
    );

    return { itemId: data.addProjectV2DraftIssue.projectV2Item.id };
  }

  /**
   * Deletes an item from the project.
   */
  public async deleteItem(itemId: string): Promise<{ deletedItemId: string }> {
    const projectId = await this.getProjectId();

    interface DeleteItemResponse {
      deleteProjectV2Item: {
        deletedItemId: string;
      };
    }

    const data = await this.executeGraphQL<DeleteItemResponse>(
      GITHUB_PROJECT_CONSTANTS.MUTATIONS.DELETE_ITEM,
      {
        input: {
          projectId,
          itemId,
        },
      },
    );

    return { deletedItemId: data.deleteProjectV2Item.deletedItemId };
  }

  /**
   * Updates the Status field of a project item.
   *
   * Supported statuses: 'Done', 'In progress', 'Backlog', 'Ready', 'In review'.
   * Normalizes case and delimiters (e.g., 'in_progress' -> 'In progress').
   */
  public async updateItemStatus(
    itemId: string,
    status: ProjectItemStatus,
  ): Promise<StatusMutationResult> {
    if (!itemId || !itemId.trim()) {
      throw new GitHubProjectError(
        "Item ID cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { itemId },
      );
    }
    if (!status || !String(status).trim()) {
      throw new GitHubProjectError(
        "Status value cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { status },
      );
    }

    const field = await this.getFieldByName(GITHUB_PROJECT_CONSTANTS.FIELD_NAME_STATUS);
    if (!field) {
      throw new GitHubProjectError(
        `Field '${GITHUB_PROJECT_CONSTANTS.FIELD_NAME_STATUS}' not found in project`,
        GITHUB_PROJECT_ERROR_CODES.FIELD_NOT_FOUND,
        { fieldName: GITHUB_PROJECT_CONSTANTS.FIELD_NAME_STATUS },
      );
    }

    const option = await this.getSingleSelectOption(
      GITHUB_PROJECT_CONSTANTS.FIELD_NAME_STATUS,
      String(status),
    );
    if (!option) {
      throw new GitHubProjectError(
        `Option '${status}' not found for field '${field.name}'. Valid options: ${
          field.options?.map((o) => o.name).join(", ") ?? "none"
        }`,
        GITHUB_PROJECT_ERROR_CODES.OPTION_NOT_FOUND,
        { fieldName: field.name, optionName: status, availableOptions: field.options },
      );
    }

    const mutationRes = await this.updateFieldValue(itemId.trim(), field.id, {
      singleSelectOptionId: option.id,
    });

    const canonicalStatus = option.name as StandardProjectStatus;
    return {
      itemId: mutationRes.itemId,
      fieldId: field.id,
      optionId: option.id,
      status: canonicalStatus,
      value: canonicalStatus,
    };
  }

  /**
   * Updates the Priority field of a project item.
   *
   * Supported priorities: 'P0', 'P1', 'P2', 'P3'.
   * Normalizes case (e.g., 'p0' -> 'P0').
   */
  public async updateItemPriority(
    itemId: string,
    priority: ProjectItemPriority,
  ): Promise<PriorityMutationResult> {
    if (!itemId || !itemId.trim()) {
      throw new GitHubProjectError(
        "Item ID cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { itemId },
      );
    }
    if (!priority || !String(priority).trim()) {
      throw new GitHubProjectError(
        "Priority value cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { priority },
      );
    }

    const field = await this.getFieldByName(GITHUB_PROJECT_CONSTANTS.FIELD_NAME_PRIORITY);
    if (!field) {
      throw new GitHubProjectError(
        `Field '${GITHUB_PROJECT_CONSTANTS.FIELD_NAME_PRIORITY}' not found in project`,
        GITHUB_PROJECT_ERROR_CODES.FIELD_NOT_FOUND,
        { fieldName: GITHUB_PROJECT_CONSTANTS.FIELD_NAME_PRIORITY },
      );
    }

    const option = await this.getSingleSelectOption(
      GITHUB_PROJECT_CONSTANTS.FIELD_NAME_PRIORITY,
      String(priority),
    );
    if (!option) {
      throw new GitHubProjectError(
        `Option '${priority}' not found for field '${field.name}'. Valid options: ${
          field.options?.map((o) => o.name).join(", ") ?? "none"
        }`,
        GITHUB_PROJECT_ERROR_CODES.OPTION_NOT_FOUND,
        { fieldName: field.name, optionName: priority, availableOptions: field.options },
      );
    }

    const mutationRes = await this.updateFieldValue(itemId.trim(), field.id, {
      singleSelectOptionId: option.id,
    });

    const canonicalPriority = option.name as StandardProjectPriority;
    return {
      itemId: mutationRes.itemId,
      fieldId: field.id,
      optionId: option.id,
      priority: canonicalPriority,
      value: canonicalPriority,
    };
  }

  /**
   * Updates the Size field of a project item.
   *
   * Supported sizes: 'XS', 'S', 'M', 'L', 'XL' (for single-select) or numeric story points.
   */
  public async updateItemSize(
    itemId: string,
    size: ProjectItemSize,
  ): Promise<SizeMutationResult> {
    if (!itemId || !itemId.trim()) {
      throw new GitHubProjectError(
        "Item ID cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { itemId },
      );
    }
    if (size === undefined || size === null || String(size).trim() === "") {
      throw new GitHubProjectError(
        "Size value cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { size },
      );
    }

    const field = await this.getFieldByName(GITHUB_PROJECT_CONSTANTS.FIELD_NAME_SIZE);
    if (!field) {
      throw new GitHubProjectError(
        `Field '${GITHUB_PROJECT_CONSTANTS.FIELD_NAME_SIZE}' not found in project`,
        GITHUB_PROJECT_ERROR_CODES.FIELD_NOT_FOUND,
        { fieldName: GITHUB_PROJECT_CONSTANTS.FIELD_NAME_SIZE },
      );
    }

    // Single-select schema (e.g., XS, S, M, L, XL)
    if (field.dataType === "SINGLE_SELECT" || (field.options && field.options.length > 0)) {
      const option = await this.getSingleSelectOption(
        GITHUB_PROJECT_CONSTANTS.FIELD_NAME_SIZE,
        String(size),
      );
      if (!option) {
        throw new GitHubProjectError(
          `Option '${size}' not found for field '${field.name}'. Valid options: ${
            field.options?.map((o) => o.name).join(", ") ?? "none"
          }`,
          GITHUB_PROJECT_ERROR_CODES.OPTION_NOT_FOUND,
          { fieldName: field.name, optionName: size, availableOptions: field.options },
        );
      }

      const mutationRes = await this.updateFieldValue(itemId.trim(), field.id, {
        singleSelectOptionId: option.id,
      });

      const canonicalSize = option.name as StandardProjectSize;
      return {
        itemId: mutationRes.itemId,
        fieldId: field.id,
        optionId: option.id,
        size: canonicalSize,
        value: canonicalSize,
      };
    }

    // Number schema
    if (field.dataType === "NUMBER" || typeof size === "number") {
      const numVal = Number(size);
      if (Number.isNaN(numVal)) {
        throw new GitHubProjectError(
          `Size value '${size}' cannot be converted to a valid number for numeric field '${field.name}'`,
          GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
          { fieldName: field.name, size },
        );
      }

      const mutationRes = await this.updateFieldValue(itemId.trim(), field.id, {
        number: numVal,
      });

      return {
        itemId: mutationRes.itemId,
        fieldId: field.id,
        size: numVal,
        value: numVal,
      };
    }

    // Text fallback
    const mutationRes = await this.updateFieldValue(itemId.trim(), field.id, {
      text: String(size),
    });

    return {
      itemId: mutationRes.itemId,
      fieldId: field.id,
      size: String(size) as StandardProjectSize,
      value: String(size) as StandardProjectSize,
    };
  }

  /**
   * Convenience method to set an item's status to Done.
   */
  public async markAsDone(itemId: string): Promise<StatusMutationResult> {
    return this.updateItemStatus(itemId, GITHUB_PROJECT_CONSTANTS.STATUS_DONE);
  }

  /**
   * Convenience method to set an item's status to In progress.
   */
  public async markAsInProgress(itemId: string): Promise<StatusMutationResult> {
    return this.updateItemStatus(itemId, GITHUB_PROJECT_CONSTANTS.STATUS_IN_PROGRESS);
  }

  /**
   * Convenience method to set an item's status to Backlog.
   */
  public async markAsBacklog(itemId: string): Promise<StatusMutationResult> {
    return this.updateItemStatus(itemId, GITHUB_PROJECT_CONSTANTS.STATUS_BACKLOG);
  }

  /**
   * Updates the Status of an item resolved by its LOOPER task key.
   */
  public async updateStatusByTaskKey(
    taskKey: string,
    status: ProjectItemStatus,
  ): Promise<StatusMutationResult> {
    if (!taskKey || !taskKey.trim()) {
      throw new GitHubProjectError(
        "Task key cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { taskKey },
      );
    }
    const item = await this.findItemByTaskKey(taskKey);
    if (!item) {
      throw new GitHubProjectError(
        `Item with task key '${taskKey}' not found in project`,
        GITHUB_PROJECT_ERROR_CODES.ITEM_NOT_FOUND,
        { taskKey },
      );
    }
    return this.updateItemStatus(item.id, status);
  }

  /**
   * Updates the Priority of an item resolved by its LOOPER task key.
   */
  public async updatePriorityByTaskKey(
    taskKey: string,
    priority: ProjectItemPriority,
  ): Promise<PriorityMutationResult> {
    if (!taskKey || !taskKey.trim()) {
      throw new GitHubProjectError(
        "Task key cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { taskKey },
      );
    }
    const item = await this.findItemByTaskKey(taskKey);
    if (!item) {
      throw new GitHubProjectError(
        `Item with task key '${taskKey}' not found in project`,
        GITHUB_PROJECT_ERROR_CODES.ITEM_NOT_FOUND,
        { taskKey },
      );
    }
    return this.updateItemPriority(item.id, priority);
  }

  /**
   * Updates the Size of an item resolved by its LOOPER task key.
   */
  public async updateSizeByTaskKey(
    taskKey: string,
    size: ProjectItemSize,
  ): Promise<SizeMutationResult> {
    if (!taskKey || !taskKey.trim()) {
      throw new GitHubProjectError(
        "Task key cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { taskKey },
      );
    }
    const item = await this.findItemByTaskKey(taskKey);
    if (!item) {
      throw new GitHubProjectError(
        `Item with task key '${taskKey}' not found in project`,
        GITHUB_PROJECT_ERROR_CODES.ITEM_NOT_FOUND,
        { taskKey },
      );
    }
    return this.updateItemSize(item.id, size);
  }

  /**
   * Convenience method to set task status to Done by task key.
   */
  public async markTaskAsDone(taskKey: string): Promise<StatusMutationResult> {
    return this.updateStatusByTaskKey(taskKey, GITHUB_PROJECT_CONSTANTS.STATUS_DONE);
  }

  /**
   * Convenience method to set task status to In progress by task key.
   */
  public async markTaskAsInProgress(taskKey: string): Promise<StatusMutationResult> {
    return this.updateStatusByTaskKey(taskKey, GITHUB_PROJECT_CONSTANTS.STATUS_IN_PROGRESS);
  }

  /**
   * Convenience method to set task status to Backlog by task key.
   */
  public async markTaskAsBacklog(taskKey: string): Promise<StatusMutationResult> {
    return this.updateStatusByTaskKey(taskKey, GITHUB_PROJECT_CONSTANTS.STATUS_BACKLOG);
  }

  /**
   * Updates multiple fields (status, priority, size) on an item sequentially.
   */
  public async updateItemFields(
    itemId: string,
    options: UpdateItemFieldsOptions,
  ): Promise<UpdateItemFieldsResult> {
    if (!itemId || !itemId.trim()) {
      throw new GitHubProjectError(
        "Item ID cannot be empty",
        GITHUB_PROJECT_ERROR_CODES.INVALID_ARGUMENT,
        { itemId },
      );
    }

    const trimmedId = itemId.trim();
    const result: UpdateItemFieldsResult = { itemId: trimmedId };

    if (options.status !== undefined) {
      result.status = await this.updateItemStatus(trimmedId, options.status);
    }
    if (options.priority !== undefined) {
      result.priority = await this.updateItemPriority(trimmedId, options.priority);
    }
    if (options.size !== undefined) {
      result.size = await this.updateItemSize(trimmedId, options.size);
    }

    return result;
  }

  /**
   * Aliases for intuitive method naming.
   */
  public async updateStatus(
    itemId: string,
    status: ProjectItemStatus,
  ): Promise<StatusMutationResult> {
    return this.updateItemStatus(itemId, status);
  }

  public async updatePriority(
    itemId: string,
    priority: ProjectItemPriority,
  ): Promise<PriorityMutationResult> {
    return this.updateItemPriority(itemId, priority);
  }

  public async updateSize(
    itemId: string,
    size: ProjectItemSize,
  ): Promise<SizeMutationResult> {
    return this.updateItemSize(itemId, size);
  }

  public async createItem(
    title: string,
    body?: string,
  ): Promise<{ itemId: string }> {
    return this.addDraftIssue(title, body);
  }

  public async listItems(maxItems?: number): Promise<ProjectV2Item[]> {
    return this.getAllItems(maxItems);
  }
}

/**
 * Factory helper for instantiating GitHubProjectService.
 */
export function createGitHubProjectService(
  config?: GitHubProjectConfig,
): GitHubProjectService {
  return new GitHubProjectService(config);
}
