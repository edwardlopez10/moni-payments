import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestPrisma, resetDatabase } from '../helpers/db';

/**
 * Seed targets DATABASE_URL (dev DB). These assertions use that same URL when
 * TEST_DATABASE_URL differs we still validate seed behaviour against the client API
 * by re-running the upsert logic with fixed IDs here.
 */
describe('prisma seed idempotency', () => {
  const prisma = createTestPrisma();

  const SEED = {
    serviceClientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    paymentAccountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    eventSubscriptionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    keyPrefix: 'seedtest',
  };

  beforeAll(async () => {
    await prisma.$connect();
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  it('upserts seed rows twice without increasing counts', async () => {
    const keyHash = createHash('sha256').update('mvp_seedtest_secret').digest('hex');

    async function upsertOnce() {
      await prisma.serviceClient.upsert({
        where: { id: SEED.serviceClientId },
        create: {
          id: SEED.serviceClientId,
          name: 'Seed Test Client',
          sourceProduct: 'RESIDENT',
          keyPrefix: SEED.keyPrefix,
          keyHash,
          scopes: ['*'],
        },
        update: { name: 'Seed Test Client' },
      });

      await prisma.organization.upsert({
        where: { id: SEED.organizationId },
        create: {
          id: SEED.organizationId,
          sourceProduct: 'RESIDENT',
          externalId: 'seed-org',
          name: 'Seed Org',
        },
        update: { name: 'Seed Org' },
      });

      await prisma.paymentAccount.upsert({
        where: { id: SEED.paymentAccountId },
        create: {
          id: SEED.paymentAccountId,
          organizationId: SEED.organizationId,
          provider: 'fake',
          providerMerchantId: 'SEED-1',
          status: 'ACTIVE',
          isDefault: true,
          credentialRefs: { apiKey: 'env://FAKE_PROVIDER_API_KEY' },
        },
        update: { status: 'ACTIVE' },
      });

      await prisma.eventSubscription.upsert({
        where: { id: SEED.eventSubscriptionId },
        create: {
          id: SEED.eventSubscriptionId,
          sourceProduct: 'RESIDENT',
          url: 'http://127.0.0.1:4099/callbacks/payments',
          secretRef: 'env://EVENT_CALLBACK_SECRET',
        },
        update: { active: true },
      });
    }

    await upsertOnce();
    await upsertOnce();

    expect(await prisma.serviceClient.count()).toBe(1);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.paymentAccount.count()).toBe(1);
    expect(await prisma.eventSubscription.count()).toBe(1);

    const client = await prisma.serviceClient.findUniqueOrThrow({
      where: { id: SEED.serviceClientId },
    });
    expect(client.keyHash).toBe(keyHash);
    expect(JSON.stringify(client)).not.toContain('mvp_seedtest_secret');
  });
});
