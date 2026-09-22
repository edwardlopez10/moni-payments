import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AppError, ErrorCode } from '../../domain/errors';
import { ingestWebhook } from './service';
import { webhookAcceptedResponseSchema } from './schema';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const providerParamsSchema = z.object({
  provider: z.string().min(1),
});

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const buffer = body as Buffer;
      (request as FastifyRequest).rawBody = buffer;
      try {
        const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
        done(null, parsed);
      } catch {
        done(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Unparseable webhook body.'),
          undefined,
        );
      }
    },
  );

  // Providers may post as text/plain or octet-stream; treat as raw bytes + optional JSON.
  for (const contentType of ['application/octet-stream', 'text/plain'] as const) {
    app.addContentTypeParser(contentType, { parseAs: 'buffer' }, (request, body, done) => {
      const buffer = body as Buffer;
      (request as FastifyRequest).rawBody = buffer;
      done(null, buffer);
    });
  }

  app.post(
    '/v1/webhooks/:provider',
    {
      schema: {
        tags: ['Webhooks'],
        security: [],
        params: providerParamsSchema,
        response: {
          202: webhookAcceptedResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const rawBody = request.rawBody;
      if (!rawBody) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Raw webhook body missing.');
      }

      const result = await ingestWebhook({
        providerKey: request.params.provider,
        rawBody,
        headers: request.headers as Record<string, string | string[] | undefined>,
        query: request.query as Record<string, string | string[] | undefined>,
      });

      return reply.status(202).send(result);
    },
  );
};
