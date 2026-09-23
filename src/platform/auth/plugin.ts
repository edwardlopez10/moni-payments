import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { AppError, ErrorCode } from '../../domain/errors';
import { credentialAuditStorage } from '../audit/credential-audit';
import { ApiKeyAuthenticator } from './api-key';
import type { ServiceAuthenticator, ServiceContext } from './service-auth';

declare module 'fastify' {
  interface FastifyRequest {
    serviceContext?: ServiceContext;
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token.trim();
}

export interface AuthPluginOptions {
  authenticator?: ServiceAuthenticator;
  /**
   * Paths that skip service auth (webhooks, health, docs, ready).
   * Matched as prefix against request.url (without query string).
   */
  publicPathPrefixes?: string[];
}

const DEFAULT_PUBLIC_PREFIXES = [
  '/health',
  '/ready',
  '/docs',
  '/v1/webhooks',
  '/__test/unmapped-error',
];

const authPluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (app, options) => {
  const authenticator = options.authenticator ?? new ApiKeyAuthenticator();
  const publicPrefixes = options.publicPathPrefixes ?? DEFAULT_PUBLIC_PREFIXES;

  app.decorateRequest('serviceContext', undefined);

  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (publicPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return;
    }

    // Only protect versioned API and authenticated test routes.
    if (!path.startsWith('/v1') && !path.startsWith('/__test/')) {
      return;
    }

    const token = extractBearerToken(request);
    if (!token) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required.');
    }

    request.serviceContext = await authenticator.authenticate(token);
  });

  app.addHook('onRequest', (request, _reply, done) => {
    if (!request.serviceContext) {
      done();
      return;
    }
    credentialAuditStorage.run(
      {
        actorType: 'SERVICE_CLIENT',
        actorId: request.serviceContext.serviceClientId,
        requestId: request.requestId || request.id,
      },
      () => {
        done();
      },
    );
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'service-auth',
});
