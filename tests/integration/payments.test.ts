import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, seedOrgWithFakeAccount } from '../helpers/api';

describe('payments API', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let prisma: Awaited<ReturnType<typeof createTestApp>>['prisma'];
  let apiKey: string;
  let organizationId: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    apiKey = ctx.apiKey;
    organizationId = await seedOrgWithFakeAccount(app, apiKey, 'pay-org');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates a processing payment with attempt 1', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-success'),
      payload: {
        organizationId,
        externalReference: 'fee-1',
        customerReference: 'cust-1',
        amount: 8500,
        currency: 'USD',
        metadata: { fakeScenario: 'success' },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('PROCESSING');
    expect(body.refundableAmount).toBe(0);
    expect(body.latestAttempt.attemptNumber).toBe(1);
  });

  it('creates an instantly paid payment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-instant'),
      payload: {
        organizationId,
        externalReference: 'fee-instant',
        customerReference: 'cust-1',
        amount: 1000,
        currency: 'USD',
        metadata: { fakeScenario: 'instant_success' },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('PAID');
    expect(body.paidAt).toBeTruthy();
    expect(body.refundableAmount).toBe(1000);
  });

  it('persists a declined payment and returns 402', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-declined'),
      payload: {
        organizationId,
        externalReference: 'fee-declined',
        customerReference: 'cust-1',
        amount: 500,
        currency: 'USD',
        metadata: { fakeScenario: 'declined' },
      },
    });
    expect(response.statusCode).toBe(402);
    expect(response.json().error.code).toBe('PAYMENT_DECLINED');
    const paymentId = response.json().error.details[0].issue.replace('existing payment id ', '').replace(/^/, '');
    // details field is "paymentId" issue is the uuid
    const detailIssue = response.json().error.details[0].issue as string;
    const row = await prisma.payment.findFirst({
      where: { externalReference: 'fee-declined' },
    });
    expect(row?.status).toBe('FAILED');
    expect(detailIssue).toBe(row?.id);
    void paymentId;
  });

  it('rejects duplicate externalReference and unsupported currency / unconfigured org', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-dup'),
      payload: {
        organizationId,
        externalReference: 'fee-1',
        customerReference: 'cust-1',
        amount: 100,
        currency: 'USD',
      },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('DUPLICATE_EXTERNAL_REFERENCE');

    const currency = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-cur'),
      payload: {
        organizationId,
        externalReference: 'fee-cur',
        customerReference: 'cust-1',
        amount: 100,
        currency: 'ZZZ',
      },
    });
    expect(currency.statusCode).toBe(422);

    const bareOrg = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(apiKey, 'bare-org'),
      payload: { externalId: 'bare', name: 'Bare' },
    });
    const bare = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-bare'),
      payload: {
        organizationId: bareOrg.json().id,
        externalReference: 'fee-bare',
        customerReference: 'cust-1',
        amount: 100,
        currency: 'USD',
      },
    });
    expect(bare.statusCode).toBe(422);
    expect(bare.json().error.code).toBe('PROVIDER_CONFIGURATION_ERROR');
  });

  it('reads payment with attempts and paginates list', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-read'),
      payload: {
        organizationId,
        externalReference: 'fee-read',
        customerReference: 'cust-1',
        amount: 200,
        currency: 'USD',
        metadata: { fakeScenario: 'instant_success' },
      },
    });
    const id = created.json().id;
    const got = await app.inject({
      method: 'GET',
      url: `/v1/payments/${id}`,
      headers: authHeaders(apiKey),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().attempts).toHaveLength(1);
    expect(got.json().refunds).toEqual([]);

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/payments?organizationId=${organizationId}&limit=2`,
      headers: authHeaders(apiKey),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.length).toBeGreaterThan(0);
  });

  it('retries failed payments and cancels processing ones', async () => {
    const declined = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-retry-create'),
      payload: {
        organizationId,
        externalReference: 'fee-retry',
        customerReference: 'cust-1',
        amount: 300,
        currency: 'USD',
        metadata: { fakeScenario: 'declined' },
      },
    });
    const failedId = (await prisma.payment.findFirst({
      where: { externalReference: 'fee-retry' },
    }))!.id;
    expect(declined.statusCode).toBe(402);

    // Force metadata for retry path by updating DB scenario isn't re-read from create —
    // retry uses stored metadata which still says declined. Update metadata for success path.
    await prisma.payment.update({
      where: { id: failedId },
      data: { metadata: { fakeScenario: 'instant_success' } },
    });

    const retried = await app.inject({
      method: 'POST',
      url: `/v1/payments/${failedId}/retry`,
      headers: authHeaders(apiKey, 'pay-retry'),
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().attempts.length).toBe(2);
    expect(retried.json().attempts[0].failureCode).toBe('PAYMENT_DECLINED');

    const processing = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pay-cancel-create'),
      payload: {
        organizationId,
        externalReference: 'fee-cancel',
        customerReference: 'cust-1',
        amount: 100,
        currency: 'USD',
        metadata: { fakeScenario: 'processing' },
      },
    });
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/payments/${processing.json().id}/cancel`,
      headers: authHeaders(apiKey, 'pay-cancel'),
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('CANCELLED');
  });
});
