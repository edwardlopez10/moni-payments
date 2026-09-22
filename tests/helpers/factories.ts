import { randomBytes, randomUUID } from 'node:crypto';

import type { PrismaClient, SourceProduct } from '@prisma/client';

import { buildApiKey, hashApiKey } from '../../src/platform/auth/service-auth';

export async function createServiceClientFactory(
  prisma: PrismaClient,
  overrides: {
    name?: string;
    sourceProduct?: SourceProduct;
    keyPrefix?: string;
    scopes?: string[];
  } = {},
): Promise<{ id: string; apiKey: string; sourceProduct: SourceProduct }> {
  const keyPrefix = overrides.keyPrefix ?? `t${randomBytes(3).toString('hex')}`;
  const apiKey = buildApiKey(keyPrefix, randomBytes(16).toString('base64url'));
  const sourceProduct = overrides.sourceProduct ?? 'RESIDENT';
  const row = await prisma.serviceClient.create({
    data: {
      name: overrides.name ?? 'Test Client',
      sourceProduct,
      keyPrefix,
      keyHash: hashApiKey(apiKey),
      scopes: overrides.scopes ?? ['*'],
    },
  });
  return { id: row.id, apiKey, sourceProduct };
}

export async function createOrganizationFactory(
  prisma: PrismaClient,
  overrides: {
    sourceProduct?: SourceProduct;
    externalId?: string;
    name?: string;
  } = {},
) {
  return prisma.organization.create({
    data: {
      sourceProduct: overrides.sourceProduct ?? 'RESIDENT',
      externalId: overrides.externalId ?? `org-${randomUUID().slice(0, 8)}`,
      name: overrides.name ?? 'Test Organization',
      status: 'ACTIVE',
      metadata: {},
    },
  });
}

export async function createPaymentAccountFactory(
  prisma: PrismaClient,
  organizationId: string,
  overrides: {
    provider?: string;
    providerMerchantId?: string;
    isDefault?: boolean;
    status?: 'ACTIVE' | 'PENDING_CONFIGURATION' | 'DISABLED';
  } = {},
) {
  return prisma.paymentAccount.create({
    data: {
      organizationId,
      provider: overrides.provider ?? 'fake',
      providerMerchantId: overrides.providerMerchantId ?? `M-${randomUUID().slice(0, 8)}`,
      status: overrides.status ?? 'ACTIVE',
      isDefault: overrides.isDefault ?? true,
      configuration: {
        checkoutMode: 'REDIRECT',
        returnUrl: 'http://localhost:3000/return',
        cancelUrl: 'http://localhost:3000/cancel',
      },
      credentialRefs: {
        apiKey: 'env://FAKE_PROVIDER_API_KEY',
        webhookSecret: 'env://FAKE_PROVIDER_WEBHOOK_SECRET',
      },
    },
  });
}

export async function createEventSubscriptionFactory(
  prisma: PrismaClient,
  overrides: {
    sourceProduct?: SourceProduct;
    organizationId?: string | null;
    url: string;
    secretRef?: string;
    eventTypes?: string[];
  },
) {
  return prisma.eventSubscription.create({
    data: {
      sourceProduct: overrides.sourceProduct ?? 'RESIDENT',
      organizationId: overrides.organizationId ?? null,
      url: overrides.url,
      secretRef: overrides.secretRef ?? 'env://EVENT_CALLBACK_SECRET',
      eventTypes: overrides.eventTypes ?? [],
      active: true,
    },
  });
}
