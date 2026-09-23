export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  ORGANIZATION_NOT_FOUND: 'ORGANIZATION_NOT_FOUND',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_METHOD_NOT_FOUND: 'PAYMENT_METHOD_NOT_FOUND',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  REQUEST_IN_PROGRESS: 'REQUEST_IN_PROGRESS',
  DUPLICATE_EXTERNAL_REFERENCE: 'DUPLICATE_EXTERNAL_REFERENCE',
  INVALID_PAYMENT_STATE: 'INVALID_PAYMENT_STATE',
  REFUND_NOT_ALLOWED: 'REFUND_NOT_ALLOWED',
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',
  INVALID_PAYMENT_METHOD: 'INVALID_PAYMENT_METHOD',
  CAPABILITY_NOT_SUPPORTED: 'CAPABILITY_NOT_SUPPORTED',
  PROVIDER_CONFIGURATION_ERROR: 'PROVIDER_CONFIGURATION_ERROR',
  /** Retryable: secret store unreachable/throttled. Never a payment outcome. */
  PROVIDER_CONFIGURATION_UNAVAILABLE: 'PROVIDER_CONFIGURATION_UNAVAILABLE',
  CURRENCY_NOT_SUPPORTED: 'CURRENCY_NOT_SUPPORTED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ORGANIZATION_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_METHOD_NOT_FOUND: 404,
  PROVIDER_NOT_FOUND: 404,
  DUPLICATE_REQUEST: 409,
  REQUEST_IN_PROGRESS: 409,
  DUPLICATE_EXTERNAL_REFERENCE: 409,
  INVALID_PAYMENT_STATE: 409,
  REFUND_NOT_ALLOWED: 409,
  PAYMENT_DECLINED: 402,
  INVALID_PAYMENT_METHOD: 402,
  CAPABILITY_NOT_SUPPORTED: 422,
  PROVIDER_CONFIGURATION_ERROR: 422,
  PROVIDER_CONFIGURATION_UNAVAILABLE: 503,
  CURRENCY_NOT_SUPPORTED: 422,
  PROVIDER_UNAVAILABLE: 502,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface ErrorDetail {
  field: string;
  issue: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: ErrorDetail[];

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      details?: ErrorDetail[];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_HTTP_STATUS[code];
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
