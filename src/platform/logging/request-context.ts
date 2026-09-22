import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

const REQUEST_ID_HEADER = 'x-request-id';

const requestContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

    request.requestId = requestId;
    void reply.header('X-Request-Id', requestId);
  });
};

export const requestContext = fp(requestContextPlugin, {
  name: 'request-context',
});
