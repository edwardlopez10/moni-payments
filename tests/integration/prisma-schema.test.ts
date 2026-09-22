import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  OrganizationStatus,
  PaymentAccountStatus,
  PaymentMethodStatus,
  PaymentMethodType,
  PaymentStatus,
  SourceProduct,
  WebhookProcessingStatus,
} from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestPrisma, resetDatabase } from '../helpers/db';

describe('prisma data model', () => {
  const prisma = createTestPrisma();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function createOrganization(externalId = 'org-1') {
    return prisma.organization.create({
      data: {
        sourceProduct: SourceProduct.RESIDENT,
        externalId,
        name: 'Test Org',
        status: OrganizationStatus.ACTIVE,
      },
    });
  }

  it('rejects duplicate (sourceProduct, externalId)', async () => {
    await createOrganization('dup-ext');
    await expect(
      createOrganization('dup-ext'),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('defaults PaymentAccount configuration and credentialRefs to empty objects', async () => {
    const org = await createOrganization();
    const account = await prisma.paymentAccount.create({
      data: {
        organizationId: org.id,
        provider: 'fake',
        providerMerchantId: 'M-1',
        status: PaymentAccountStatus.ACTIVE,
      },
    });

    expect(account.configuration).toEqual({});
    expect(account.credentialRefs).toEqual({});
  });

  it('rejects duplicate (organizationId, externalReference)', async () => {
    const org = await createOrganization();
    const base = {
      organizationId: org.id,
      sourceProduct: SourceProduct.RESIDENT,
      externalReference: 'fee-1',
      customerReference: 'cust-1',
      amount: 8500,
      currency: 'USD',
      provider: 'fake',
      status: PaymentStatus.PENDING,
    };

    await prisma.payment.create({ data: base });
    await expect(prisma.payment.create({ data: base })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('rejects duplicate (provider, providerPaymentId) but allows multiple nulls', async () => {
    const org = await createOrganization();

    await prisma.payment.create({
      data: {
        organizationId: org.id,
        sourceProduct: SourceProduct.RESIDENT,
        externalReference: 'a',
        customerReference: 'c',
        amount: 100,
        currency: 'USD',
        provider: 'fake',
        providerPaymentId: null,
      },
    });
    await prisma.payment.create({
      data: {
        organizationId: org.id,
        sourceProduct: SourceProduct.RESIDENT,
        externalReference: 'b',
        customerReference: 'c',
        amount: 100,
        currency: 'USD',
        provider: 'fake',
        providerPaymentId: null,
      },
    });

    await prisma.payment.create({
      data: {
        organizationId: org.id,
        sourceProduct: SourceProduct.RESIDENT,
        externalReference: 'c1',
        customerReference: 'c',
        amount: 100,
        currency: 'USD',
        provider: 'fake',
        providerPaymentId: 'prov_1',
      },
    });

    await expect(
      prisma.payment.create({
        data: {
          organizationId: org.id,
          sourceProduct: SourceProduct.RESIDENT,
          externalReference: 'c2',
          customerReference: 'c',
          amount: 100,
          currency: 'USD',
          provider: 'fake',
          providerPaymentId: 'prov_1',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('defaults refundedAmount to 0', async () => {
    const org = await createOrganization();
    const payment = await prisma.payment.create({
      data: {
        organizationId: org.id,
        sourceProduct: SourceProduct.RESIDENT,
        externalReference: 'fee-refund-default',
        customerReference: 'c',
        amount: 500,
        currency: 'USD',
        provider: 'fake',
      },
    });
    expect(payment.refundedAmount).toBe(0);
  });

  it('rejects duplicate webhook (provider, providerEventId)', async () => {
    await prisma.webhookEvent.create({
      data: {
        provider: 'fake',
        providerEventId: 'evt_1',
        payload: {},
        rawBody: '{}',
        processingStatus: WebhookProcessingStatus.RECEIVED,
      },
    });

    await expect(
      prisma.webhookEvent.create({
        data: {
          provider: 'fake',
          providerEventId: 'evt_1',
          payload: {},
          rawBody: '{}',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects duplicate idempotency (serviceClientId, key, endpoint)', async () => {
    const client = await prisma.serviceClient.create({
      data: {
        name: 'test',
        sourceProduct: SourceProduct.RESIDENT,
        keyPrefix: 'prefix1',
        keyHash: 'hash1',
      },
    });

    const base = {
      serviceClientId: client.id,
      key: 'k1',
      endpoint: 'POST /v1/payments',
      requestFingerprint: 'fp1',
      expiresAt: new Date(Date.now() + 86_400_000),
    };

    await prisma.idempotencyKey.create({ data: base });
    await expect(prisma.idempotencyKey.create({ data: base })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('enforces unique OutboxEvent.eventId', async () => {
    await prisma.outboxEvent.create({
      data: {
        eventType: 'payment.paid',
        eventId: 'evt-unique-1',
        organizationId: 'org',
        sourceProduct: SourceProduct.RESIDENT,
        resourceType: 'payment',
        resourceId: 'pay_1',
        payload: {},
      },
    });

    await expect(
      prisma.outboxEvent.create({
        data: {
          eventType: 'payment.paid',
          eventId: 'evt-unique-1',
          organizationId: 'org',
          sourceProduct: SourceProduct.RESIDENT,
          resourceType: 'payment',
          resourceId: 'pay_2',
          payload: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('has dispatcher polling indexes', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'webhook_events_processing_status_next_retry_at_idx',
          'outbox_events_status_next_attempt_at_idx'
        )
    `;
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain('webhook_events_processing_status_next_retry_at_idx');
    expect(names).toContain('outbox_events_status_next_attempt_at_idx');
  });

  it('rejects payments that violate financial CHECK constraints', async () => {
    const org = await createOrganization('check-org');

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO payments (
           id, organization_id, source_product, external_reference, customer_reference,
           amount, currency, refunded_amount, status, provider, created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1, 'RESIDENT', 'bad-amount', 'c',
           0, 'USD', 0, 'PENDING', 'fake', NOW(), NOW()
         )`,
        org.id,
      ),
    ).rejects.toBeTruthy();

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO payments (
           id, organization_id, source_product, external_reference, customer_reference,
           amount, currency, refunded_amount, status, provider, created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1, 'RESIDENT', 'bad-currency', 'c',
           100, 'usd', 0, 'PENDING', 'fake', NOW(), NOW()
         )`,
        org.id,
      ),
    ).rejects.toBeTruthy();

    await prisma.$executeRawUnsafe(
      `INSERT INTO payments (
         id, organization_id, source_product, external_reference, customer_reference,
         amount, currency, refunded_amount, status, provider, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, 'RESIDENT', 'over-refund', 'c',
         100, 'USD', 0, 'PAID', 'fake', NOW(), NOW()
       )`,
      org.id,
    );

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE payments SET refunded_amount = 101 WHERE external_reference = 'over-refund'`,
      ),
    ).rejects.toBeTruthy();
  });

  it('enforces one default payment account per organization', async () => {
    const org = await createOrganization('default-acct');
    await prisma.paymentAccount.create({
      data: {
        organizationId: org.id,
        provider: 'fake',
        providerMerchantId: 'M-A',
        isDefault: true,
        status: PaymentAccountStatus.ACTIVE,
      },
    });

    await expect(
      prisma.paymentAccount.create({
        data: {
          organizationId: org.id,
          provider: 'fake',
          providerMerchantId: 'M-B',
          isDefault: true,
          status: PaymentAccountStatus.ACTIVE,
        },
      }),
    ).rejects.toBeTruthy();
  });

  it('enforces one default active payment method per customer', async () => {
    const org = await createOrganization('default-pm');
    await prisma.paymentMethod.create({
      data: {
        organizationId: org.id,
        customerReference: 'cust-1',
        provider: 'fake',
        providerPaymentMethodId: 'pm_1',
        type: PaymentMethodType.CARD,
        status: PaymentMethodStatus.ACTIVE,
        last4: '4242',
        isDefault: true,
      },
    });

    await expect(
      prisma.paymentMethod.create({
        data: {
          organizationId: org.id,
          customerReference: 'cust-1',
          provider: 'fake',
          providerPaymentMethodId: 'pm_2',
          type: PaymentMethodType.CARD,
          status: PaymentMethodStatus.ACTIVE,
          last4: '1111',
          isDefault: true,
        },
      }),
    ).rejects.toBeTruthy();
  });

  it('PaymentMethod last4 is CHAR(4) and schema has no forbidden card fields', async () => {
    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; data_type: string; character_maximum_length: number | null }>
    >`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'payment_methods'
    `;

    const last4 = columns.find((c) => c.column_name === 'last4');
    expect(last4?.data_type).toBe('character');
    expect(last4?.character_maximum_length).toBe(4);

    const names = columns.map((c) => c.column_name.toLowerCase());
    for (const forbidden of ['cardnumber', 'card_number', 'cvv', 'cvc', 'pan', 'track2', 'track_2']) {
      expect(names).not.toContain(forbidden);
    }

    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    for (const pattern of [/cardNumber/i, /\bcvv\b/i, /\bpan\b/i, /track2/i]) {
      expect(schema).not.toMatch(pattern);
    }
  });

  it('stores no plaintext credential columns on payment accounts', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'payment_accounts'
    `;
    const names = columns.map((c) => c.column_name.toLowerCase());
    expect(names).toContain('credential_refs');
    expect(names).not.toContain('api_key');
    expect(names).not.toContain('secret');
    expect(names).not.toContain('password');
  });
});
