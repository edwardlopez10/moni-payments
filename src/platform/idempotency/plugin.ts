import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { AppError, ErrorCode } from '../../domain/errors';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  fingerprintRequest,
} from './store';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function endpointKey(request: FastifyRequest): string {
  const path = request.routeOptions.url ?? request.url.split('?')[0] ?? request.url;
  return `${request.method} ${path}`;
}

function pathParams(request: FastifyRequest): Record<string, string> {
  const params = request.params;
  if (!params || typeof params !== 'object') {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

const idempotencyPluginImpl: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) {
      return;
    }

    const path = request.url.split('?')[0] ?? request.url;
    if (!path.startsWith('/v1') && !path.startsWith('/__test/idempotent')) {
      return;
    }

    // Webhooks are authenticated by provider signature and have their own dedupe.
    if (path.startsWith('/v1/webhooks')) {
      return;
    }

    const keyHeader = request.headers['idempotency-key'];
    if (typeof keyHeader !== 'string' || keyHeader.trim().length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Idempotency-Key header is required.', {
        details: [{ field: 'Idempotency-Key', issue: 'required on mutating requests' }],
      });
    }

    const serviceContext = request.serviceContext;
    if (!serviceContext) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required.');
    }

    const fingerprint = fingerprintRequest(request.body, pathParams(request));
    const result = await beginIdempotentRequest({
      serviceClientId: serviceContext.serviceClientId,
      key: keyHeader.trim(),
      endpoint: endpointKey(request),
      fingerprint,
    });

    if (result.kind === 'conflict') {
      throw new AppError(
        ErrorCode.DUPLICATE_REQUEST,
        'Idempotency-Key was reused with a different payload.',
      );
    }

    if (result.kind === 'in_progress') {
      throw new AppError(
        ErrorCode.REQUEST_IN_PROGRESS,
        'A request with this Idempotency-Key is still in progress.',
      );
    }

    if (result.kind === 'replay') {
      void reply.header('Idempotency-Replayed', 'true');
      return reply.status(result.statusCode).send(result.body);
    }

    (request as FastifyRequest & { idempotencyRecordId?: string }).idempotencyRecordId =
      result.recordId;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const recordId = (request as FastifyRequest & { idempotencyRecordId?: string })
      .idempotencyRecordId;
    if (!recordId) {
      return payload;
    }

    let body: unknown = payload;
    if (typeof payload === 'string') {
      try {
        body = JSON.parse(payload);
      } catch {
        body = payload;
      }
    }

    try {
      await completeIdempotentRequest(recordId, reply.statusCode, body);
    } catch {
      await failIdempotentRequest(recordId).catch(() => undefined);
    }

    return payload;
  });

  app.addHook('onError', async (request, _reply, _error) => {
    const recordId = (request as FastifyRequest & { idempotencyRecordId?: string })
      .idempotencyRecordId;
    if (recordId) {
      await failIdempotentRequest(recordId).catch(() => undefined);
    }
  });
};

export const idempotencyPlugin = fp(idempotencyPluginImpl, {
  name: 'idempotency',
  dependencies: ['service-auth'],
});
