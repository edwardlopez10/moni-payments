import { resolve } from 'node:path';

import type { SourceProduct } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';

import { buildApp, type AppInstance } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import {
  createEventSubscriptionFactory,
  createOrganizationFactory,
  createPaymentAccountFactory,
  createServiceClientFactory,
} from './factories';
import { createTestPrisma, resetDatabase } from './db';
import {
  startSimulatedProductBackend,
  type SimulatedProductBackend,
} from './simulated-product-backend';

loadDotenv({ path: resolve(process.cwd(), '.env') });

export interface TestAppContext {
  app: AppInstance;
  prisma: ReturnType<typeof createTestPrisma>;
  apiKey: string;
  sourceProduct: SourceProduct;
  backend?: SimulatedProductBackend;
}

export interface CreateTestAppOptions {
  /** Start a simulated product backend and register an event subscription. */
  withBackend?: boolean;
  /** Override rate limits (useful for 429 tests). */
  rateLimitMax?: number;
  webhookRateLimitMax?: number;
  sourceProduct?: SourceProduct;
  /** NODE_ENV for the app under test. */
  nodeEnv?: 'development' | 'test' | 'production';
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestAppContext> {
  process.env.FAKE_PROVIDER_API_KEY ??= 'test-fake-api-key';
  process.env.FAKE_PROVIDER_WEBHOOK_SECRET ??= 'test-fake-webhook-secret';
  process.env.EVENT_CALLBACK_SECRET ??= 'test-callback-secret';

  const prisma = createTestPrisma();
  await prisma.$connect();
  await resetDatabase(prisma);

  const client = await createServiceClientFactory(prisma, {
    sourceProduct: options.sourceProduct ?? 'RESIDENT',
    keyPrefix: 'phase6',
  });

  let backend: SimulatedProductBackend | undefined;
  if (options.withBackend) {
    backend = await startSimulatedProductBackend({
      secret: process.env.EVENT_CALLBACK_SECRET,
    });
    await createEventSubscriptionFactory(prisma, {
      sourceProduct: client.sourceProduct,
      url: backend.url,
      secretRef: 'env://EVENT_CALLBACK_SECRET',
    });
  }

  const env = loadEnv({
    ...process.env,
    NODE_ENV: options.nodeEnv ?? 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
    DISPATCHER_INTERVAL_MS: '0',
    RATE_LIMIT_MAX: String(options.rateLimitMax ?? 300),
    WEBHOOK_RATE_LIMIT_MAX: String(options.webhookRateLimitMax ?? 120),
  });
  const app = await buildApp({ env });
  await app.ready();

  const result: TestAppContext = {
    app,
    prisma,
    apiKey: client.apiKey,
    sourceProduct: client.sourceProduct,
  };
  if (backend) {
    result.backend = backend;
  }
  return result;
}

export async function closeTestApp(ctx: TestAppContext): Promise<void> {
  await ctx.app.close();
  await ctx.prisma.$disconnect();
  if (ctx.backend) {
    await ctx.backend.close();
  }
}

export function authHeaders(apiKey: string, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
  };
  if (idempotencyKey !== undefined) {
    headers['idempotency-key'] = idempotencyKey;
  }
  return headers;
}

export async function seedOrgWithFakeAccount(
  app: AppInstance,
  apiKey: string,
  externalId: string,
  provider = 'fake',
): Promise<string> {
  const org = await app.inject({
    method: 'POST',
    url: '/v1/organizations',
    headers: authHeaders(apiKey, `org-${externalId}`),
    payload: { externalId, name: externalId },
  });
  const organizationId = org.json().id as string;
  const account = await app.inject({
    method: 'POST',
    url: `/v1/organizations/${organizationId}/payment-accounts`,
    headers: authHeaders(apiKey, `acct-${externalId}`),
    payload: {
      provider,
      providerMerchantId: `M-${externalId}`,
      isDefault: true,
      credentialRefs: {
        apiKey: 'env://FAKE_PROVIDER_API_KEY',
        webhookSecret: 'env://FAKE_PROVIDER_WEBHOOK_SECRET',
      },
    },
  });
  if (account.statusCode >= 400) {
    throw new Error(`Failed to create account: ${account.body}`);
  }
  return organizationId;
}

export {
  createOrganizationFactory,
  createPaymentAccountFactory,
  createServiceClientFactory,
  createEventSubscriptionFactory,
};
