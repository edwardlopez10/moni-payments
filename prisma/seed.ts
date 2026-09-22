import { randomBytes } from 'node:crypto';

import {
  OrganizationStatus,
  PaymentAccountStatus,
  PrismaClient,
  ServiceClientStatus,
  SourceProduct,
} from '@prisma/client';

import { buildApiKey, hashApiKey } from '../src/platform/auth/service-auth';

const prisma = new PrismaClient();

/** Fixed IDs so repeated seeds are idempotent upserts. */
const SEED = {
  serviceClientId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  paymentAccountId: '33333333-3333-4333-8333-333333333333',
  eventSubscriptionId: '44444444-4444-4444-8444-444444444444',
  keyPrefix: 'devlocal',
} as const;

function buildSeedKey(prefix: string, secret: string): string {
  return buildApiKey(prefix, secret);
}

async function main(): Promise<void> {
  const existing = await prisma.serviceClient.findUnique({
    where: { id: SEED.serviceClientId },
  });

  let plaintextKey: string | null = null;
  let keyHash: string;

  if (existing) {
    keyHash = existing.keyHash;
  } else {
    const secret = randomBytes(24).toString('base64url');
    plaintextKey = buildSeedKey(SEED.keyPrefix, secret);
    keyHash = hashApiKey(plaintextKey);
  }

  await prisma.serviceClient.upsert({
    where: { id: SEED.serviceClientId },
    create: {
      id: SEED.serviceClientId,
      name: 'Local Development Client',
      sourceProduct: SourceProduct.RESIDENT,
      keyPrefix: SEED.keyPrefix,
      keyHash,
      scopes: ['*'],
      status: ServiceClientStatus.ACTIVE,
    },
    update: {
      name: 'Local Development Client',
      status: ServiceClientStatus.ACTIVE,
      revokedAt: null,
    },
  });

  await prisma.organization.upsert({
    where: { id: SEED.organizationId },
    create: {
      id: SEED.organizationId,
      sourceProduct: SourceProduct.RESIDENT,
      externalId: 'demo-condo-1',
      name: 'Demo Condominium',
      status: OrganizationStatus.ACTIVE,
      metadata: { seeded: true },
    },
    update: {
      name: 'Demo Condominium',
      status: OrganizationStatus.ACTIVE,
    },
  });

  await prisma.paymentAccount.upsert({
    where: { id: SEED.paymentAccountId },
    create: {
      id: SEED.paymentAccountId,
      organizationId: SEED.organizationId,
      provider: 'fake',
      providerMerchantId: 'FAKE-MERCHANT-001',
      status: PaymentAccountStatus.ACTIVE,
      isDefault: true,
      configuration: {
        checkoutMode: 'REDIRECT',
        returnUrl: 'http://localhost:3000/payments/return',
        cancelUrl: 'http://localhost:3000/payments/cancel',
      },
      credentialRefs: {
        apiKey: 'env://FAKE_PROVIDER_API_KEY',
        webhookSecret: 'env://FAKE_PROVIDER_WEBHOOK_SECRET',
      },
    },
    update: {
      status: PaymentAccountStatus.ACTIVE,
      isDefault: true,
    },
  });

  await prisma.eventSubscription.upsert({
    where: { id: SEED.eventSubscriptionId },
    create: {
      id: SEED.eventSubscriptionId,
      sourceProduct: SourceProduct.RESIDENT,
      organizationId: null,
      url: 'http://127.0.0.1:4099/callbacks/payments',
      secretRef: 'env://EVENT_CALLBACK_SECRET',
      eventTypes: [],
      active: true,
    },
    update: {
      url: 'http://127.0.0.1:4099/callbacks/payments',
      active: true,
    },
  });

  console.log('Seed complete.');
  console.log(`  organizationId: ${SEED.organizationId}`);
  console.log(`  paymentAccountId: ${SEED.paymentAccountId}`);
  console.log(`  serviceClientId: ${SEED.serviceClientId}`);

  if (plaintextKey) {
    console.log('');
    console.log('API key (shown once; store it securely):');
    console.log(`  ${plaintextKey}`);
  } else {
    console.log('  service client already existed; API key was not re-printed.');
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
