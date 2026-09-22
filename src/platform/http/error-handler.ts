import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { AppError, ErrorCode, isAppError } from '../../domain/errors';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Array<{ field: string; issue: string }>;
  };
}

function requestIdFrom(request: FastifyRequest): string {
  return request.requestId ?? 'unknown';
}

export function toErrorBody(
  error: unknown,
  requestId: string,
): { statusCode: number; body: ApiErrorBody } {
  if (isAppError(error)) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    };
    if (error.details !== undefined) {
      body.error.details = error.details;
    }
    return { statusCode: error.statusCode, body };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 422,
      body: {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Request failed schema validation.',
          requestId,
          details: error.issues.map((issue) => ({
            field: issue.path.map(String).join('.') || '(root)',
            issue: issue.message,
          })),
        },
      },
    };
  }

  const fastifyError = error as FastifyError;
  if (fastifyError?.statusCode === 413 || fastifyError?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return {
      statusCode: 413,
      body: {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Request body too large.',
          requestId,
        },
      },
    };
  }

  if (fastifyError?.statusCode === 429) {
    return {
      statusCode: 429,
      body: {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Rate limit exceeded.',
          requestId,
        },
      },
    };
  }

  if (fastifyError?.validation) {
    return {
      statusCode: 422,
      body: {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Request failed schema validation.',
          requestId,
          details: fastifyError.validation.map((issue) => ({
            field: issue.instancePath?.replace(/^\//, '').replace(/\//g, '.') || '(root)',
            issue: issue.message ?? 'Invalid value',
          })),
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred.',
        requestId,
      },
    },
  };
}

export function createErrorHandler() {
  return function errorHandler(
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const requestId = requestIdFrom(request);
    const { statusCode, body } = toErrorBody(error, requestId);

    if (statusCode >= 500) {
      request.log.error({ err: error, requestId }, 'Unhandled error');
    } else {
      request.log.warn({ err: error, requestId, code: body.error.code }, 'Request failed');
    }

    void reply.status(statusCode).send(body);
  };
}

export function assertNeverReached(): never {
  throw new AppError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred.');
}
