import type { ProviderFailureCode } from './types';

export class ProviderError extends Error {
  readonly code: ProviderFailureCode;
  readonly providerCode?: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(
    code: ProviderFailureCode,
    message: string,
    options: {
      providerCode?: string;
      retryable: boolean;
      httpStatus?: number;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options.retryable;
    if (options.providerCode !== undefined) {
      this.providerCode = options.providerCode;
    }
    if (options.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
