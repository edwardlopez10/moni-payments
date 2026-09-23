import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode, ERROR_HTTP_STATUS } from '../../../src/domain/errors';
import { toErrorBody } from '../../../src/platform/http/error-handler';

describe('ERROR_HTTP_STATUS', () => {
  it('maps every ErrorCode to its documented HTTP status', () => {
    const expected: Record<ErrorCode, number> = {
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

    for (const code of Object.values(ErrorCode) as ErrorCode[]) {
      expect(ERROR_HTTP_STATUS[code]).toBe(expected[code]);
      const error = new AppError(code, 'test');
      expect(error.statusCode).toBe(expected[code]);
    }
  });
});

describe('toErrorBody', () => {
  it('includes requestId on every body', () => {
    const { body } = toErrorBody(new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'missing'), 'req-1');
    expect(body.error.requestId).toBe('req-1');
  });

  it('maps PROVIDER_CONFIGURATION_UNAVAILABLE to 503 and keeps permanent config errors at 422', () => {
    const unavailable = new AppError(
      ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE,
      'Secret store temporarily unavailable.',
    );
    const permanent = new AppError(
      ErrorCode.PROVIDER_CONFIGURATION_ERROR,
      'Secret reference could not be resolved (missing).',
    );
    expect(unavailable.statusCode).toBe(503);
    expect(permanent.statusCode).toBe(422);

    const { statusCode, body } = toErrorBody(unavailable, 'req-unavailable');
    expect(statusCode).toBe(503);
    expect(body.error.code).toBe('PROVIDER_CONFIGURATION_UNAVAILABLE');
    expect(body.error.requestId).toBe('req-unavailable');
  });

  it('maps unmapped throws to INTERNAL_ERROR without leaking the original message', () => {
    const { statusCode, body } = toErrorBody(new Error('secret stack detail'), 'req-2');
    expect(statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('secret stack detail');
  });
});
