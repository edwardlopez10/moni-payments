import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import { SERVICE_VERSION } from '../../config/constants';
import type { Env } from '../../config/env';

/** Fastify instances vary by logger and type provider; keep this intentionally loose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type App = FastifyInstance<any, any, any, any, any>;

export function registerZodCompilers(app: App): void {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
}

export async function registerOpenApi(app: App, env: Env): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Moniveo Payments API',
        description: 'Centralized payment orchestration for Moniveo products',
        version: SERVICE_VERSION,
      },
      tags: [
        { name: 'Organizations' },
        { name: 'Payment Accounts' },
        { name: 'Payments' },
        { name: 'Refunds' },
        { name: 'Payment Methods' },
        { name: 'Providers' },
        { name: 'Webhooks' },
        { name: 'Health' },
        { name: 'Development' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API Key',
          },
        },
      },
      // Default: protected routes. Public routes set `security: []` in their schema.
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });

  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      staticCSP: true,
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });
  }
}
