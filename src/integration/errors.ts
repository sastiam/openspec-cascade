/**
 * Error Taxonomy and Structured Exception Hierarchy for Catalog and Integration Modules.
 *
 * Implements LOOPER-INT-003 and LOOPER-INT-004 error definitions for the
 * Agnostic Multi-Agent Looper specification.
 */

export type CatalogGeneratorErrorCode =
  | "INVALID_ARGUMENT"
  | "FILE_WRITE_ERROR"
  | "FILE_READ_ERROR"
  | "PROJECT_FETCH_ERROR"
  | "PARSE_ERROR"
  | "SCHEMA_VALIDATION_ERROR"
  | "CATALOG_DRIFT_DETECTED"
  | "UNKNOWN_ERROR";

/**
 * Base structured domain error thrown by catalog operations.
 */
export class CatalogGeneratorError extends Error {
  readonly code: CatalogGeneratorErrorCode;
  override readonly cause?: unknown;

  constructor(message: string, code: CatalogGeneratorErrorCode, cause?: unknown) {
    super(message);
    this.name = "CatalogGeneratorError";
    this.code = code;
    this.cause = cause;
  }
}
