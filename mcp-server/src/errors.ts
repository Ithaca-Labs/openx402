/**
 * Stable, versioned error contract. Human text may improve across releases;
 * callers branch only on `code`. `SETTLEMENT_UNKNOWN` is retryable only
 * through status polling, never by authorizing another payment.
 */
export const ERROR_CODES = [
  "INVALID_ARGUMENT",
  "NO_RESULTS",
  "RESOURCE_STALE",
  "RESOURCE_CHANGED",
  "UNTRUSTED_REDIRECT",
  "PAYMENT_REQUIRED",
  "BUDGET_EXCEEDED",
  "PAYMENT_REJECTED",
  "SETTLEMENT_UNKNOWN",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_PROTOCOL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const RETRYABLE: Record<ErrorCode, boolean> = {
  INVALID_ARGUMENT: false,
  NO_RESULTS: false,
  RESOURCE_STALE: true,
  RESOURCE_CHANGED: false,
  UNTRUSTED_REDIRECT: false,
  PAYMENT_REQUIRED: true,
  BUDGET_EXCEEDED: false,
  PAYMENT_REJECTED: false,
  // Retryable, but only via status polling -- never by re-authorizing.
  SETTLEMENT_UNKNOWN: true,
  UPSTREAM_TIMEOUT: true,
  UPSTREAM_PROTOCOL_ERROR: false,
};

export interface ErrorPayload {
  schemaVersion: 1;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class McpToolError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toPayload(): ErrorPayload {
    return {
      schemaVersion: 1,
      code: this.code,
      message: this.message,
      retryable: RETRYABLE[this.code],
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE[code];
}

/** Wraps any thrown value into the deterministic error contract. */
export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof McpToolError) return error.toPayload();
  return {
    schemaVersion: 1,
    code: "UPSTREAM_PROTOCOL_ERROR",
    message: error instanceof Error ? error.message : "unknown error",
    retryable: false,
  };
}
