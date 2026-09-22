import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Pool } from 'pg';
import { z } from 'zod';

import type { Env } from './config/env';
import { healthRoutes } from './modules/health/routes';
import { organizationRoutes } from './modules/organizations/routes';
import { paymentAccountRoutes } from './modules/payment-accounts/routes';
import { paymentMethodRoutes } from './modules/payment-methods/routes';
import { paymentRoutes } from './modules/payments/routes';
import { providerRoutes } from './modules/providers/routes';
import { refundRoutes } from './modules/refunds/routes';
import { webhookRoutes } from './modules/webhooks/routes';
import { authPlugin } from './platform/auth/plugin';
import { EventDispatcher } from './platform/events/dispatcher';
import { createErrorHandler } from './platform/http/error-handler';
import { registerOpenApi, registerZodCompilers } from './platform/http/openapi';
import { idempotencyPlugin } from './platform/idempotency/plugin';
import { buildLoggerOptions } from './platform/logging/logger';
import { requestContext } from './platform/logging/request-context';
import {
  BODY_LIMIT_BYTES,
  registerSecurityPlugins,
} from './platform/security/plugins';
import { getProviderRegistry } from './providers/registry';
import { devRoutes } from './routes/dev';

export interface BuildAppOptions {
  env: Env;
  /** Override the Postgres pool (tests). */
  pool?: Pool;
  /** Provider keys reported by /ready. */
  getRegisteredProviders?: () => string[];
  startedAt?: number;
  /** Override dispatcher interval; defaults to env.DISPATCHER_INTERVAL_MS. */
  dispatcherIntervalMs?: number;
}

export async function buildApp(options: BuildAppOptions) {
  const { env } = options;
  const pool =
    options.pool ??
    new Pool({
      connectionString: env.DATABASE_URL,
    });
  const getRegisteredProviders =
    options.getRegisteredProviders ?? (() => [...getProviderRegistry().keys()]);
  const startedAt = options.startedAt ?? Date.now();
  const dispatcherIntervalMs =
    options.dispatcherIntervalMs ??
    env.DISPATCHER_INTERVAL_MS ??
    (env.NODE_ENV === 'test' ? 0 : 2000);

  const app = Fastify({
    logger: buildLoggerOptions(env),
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && header.length > 0 ? header : randomUUID();
    },
    requestIdHeader: 'x-request-id',
  }).withTypeProvider<ZodTypeProvider>();

  registerZodCompilers(app);
  app.setErrorHandler(createErrorHandler());
  await app.register(requestContext);
  await registerSecurityPlugins(app, env);
  await registerOpenApi(app, env);
  await app.register(authPlugin);
  await app.register(idempotencyPlugin);

  await app.register(healthRoutes, {
    pool,
    getRegisteredProviders,
    startedAt,
  });
  await app.register(organizationRoutes);
  await app.register(paymentAccountRoutes);
  await app.register(paymentRoutes);
  await app.register(refundRoutes);
  await app.register(paymentMethodRoutes);
  await app.register(providerRoutes);
  await app.register(webhookRoutes);

  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
    await app.register(devRoutes);
  }

  const dispatcher = new EventDispatcher({
    intervalMs: dispatcherIntervalMs,
    logger: app.log,
  });
  dispatcher.start();
  app.decorate('dispatcher', dispatcher);

  if (env.NODE_ENV === 'test') {
    app.get('/__test/unmapped-error', async () => {
      throw new Error('secret internal detail must not leak');
    });

    app.get('/__test/auth/me', async (request) => ({
      serviceClientId: request.serviceContext?.serviceClientId,
      sourceProduct: request.serviceContext?.sourceProduct,
    }));

    let idempotentCounter = 0;
    app.post(
      '/__test/idempotent',
      {
        schema: {
          body: z.object({
            value: z.string(),
          }),
        },
      },
      async (request) => {
        if (request.headers['x-test-fail'] === '1') {
          throw new Error('boom');
        }
        idempotentCounter += 1;
        return {
          value: request.body.value,
          count: idempotentCounter,
        };
      },
    );
  }

  app.addHook('onClose', async () => {
    await dispatcher.stop();
    await pool.end();
  });

  return app;
}

export type AppInstance = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    dispatcher: EventDispatcher;
  }
}
