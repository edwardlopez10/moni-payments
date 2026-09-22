import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import type { Env } from '../../config/env';

/** Body size limit (~256 KiB) — oversized requests yield 413. */
export const BODY_LIMIT_BYTES = 256 * 1024;

function pathOf(request: { url: string }): string {
  return request.url.split('?')[0] ?? request.url;
}

export async function registerSecurityPlugins(
  app: FastifyInstance,
  env: Pick<Env, 'RATE_LIMIT_MAX' | 'WEBHOOK_RATE_LIMIT_MAX'>,
): Promise<void> {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });

  // General API limiter — webhooks are excluded (they use the independent limiter below).
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    hook: 'onRequest',
    max: env.RATE_LIMIT_MAX,
    nameSpace: 'api-rate-limit-',
    allowList: (request) => pathOf(request).startsWith('/v1/webhooks'),
  });

  // Independent webhook limiter.
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    hook: 'onRequest',
    max: env.WEBHOOK_RATE_LIMIT_MAX,
    nameSpace: 'webhook-rate-limit-',
    allowList: (request) => !pathOf(request).startsWith('/v1/webhooks'),
  });
}
