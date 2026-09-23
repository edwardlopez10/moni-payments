import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp, seedOrgWithFakeAccount } from '../helpers/api';

describe('refunds, payment methods, providers', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let prisma: Awaited<ReturnType<typeof createTestApp>>['prisma'];
  let apiKey: string;
  let organizationId: string;
  let paidPaymentId: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    apiKey = ctx.apiKey;

    organizationId = await seedOrgWithFakeAccount(app, apiKey, 'misc-org');

    const paid = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'misc-paid'),
      payload: {
        organizationId,
        externalReference: 'misc-paid',
        customerReference: 'cust-misc',
        amount: 1000,
        currency: 'USD',
        metadata: { fakeScenario: 'instant_success' },
      },
    });
    paidPaymentId = paid.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('refunds partially then fully; rejects over-refund and pending refunds', async () => {
    const partial = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paidPaymentId}/refunds`,
      headers: authHeaders(apiKey, 'rf-partial'),
      payload: { amount: 400 },
    });
    expect(partial.statusCode).toBe(201);
    expect(partial.json().payment.status).toBe('PARTIALLY_REFUNDED');
    expect(partial.json().payment.refundableAmount).toBe(600);

    const rest = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paidPaymentId}/refunds`,
      headers: authHeaders(apiKey, 'rf-rest'),
      payload: { amount: 600 },
    });
    expect(rest.statusCode).toBe(201);
    expect(rest.json().payment.status).toBe('REFUNDED');

    const over = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paidPaymentId}/refunds`,
      headers: authHeaders(apiKey, 'rf-over'),
      payload: { amount: 1 },
    });
    expect(over.statusCode).toBe(409);

    const pendingPay = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'rf-pending-pay'),
      payload: {
        organizationId,
        externalReference: 'misc-pending',
        customerReference: 'cust-misc',
        amount: 100,
        currency: 'USD',
        metadata: { fakeScenario: 'processing' },
      },
    });
    const pendingRefund = await app.inject({
      method: 'POST',
      url: `/v1/payments/${pendingPay.json().id}/refunds`,
      headers: authHeaders(apiKey, 'rf-pending'),
      payload: {},
    });
    expect(pendingRefund.statusCode).toBe(409);
  });

  it('creates and lists payment methods; rejects unknown fields', async () => {
    const { FakePaymentProvider } = await import('../../src/providers/fake');
    const token = new FakePaymentProvider().createSetupToken();

    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/customers/cust-misc/payment-methods`,
      headers: authHeaders(apiKey, 'pm-create'),
      payload: { setupToken: token, setDefault: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().last4).toMatch(/^\d{4}$/);
    expect(created.json().providerPaymentMethodId).toBeUndefined();

    const withPan = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/customers/cust-misc/payment-methods`,
      headers: authHeaders(apiKey, 'pm-pan'),
      payload: { setupToken: token, setDefault: false, cardNumber: '4242424242424242' },
    });
    expect(withPan.statusCode).toBe(422);

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/customers/cust-misc/payment-methods`,
      headers: authHeaders(apiKey),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.length).toBeGreaterThan(0);
  });

  it('lists providers from the registry', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/providers',
      headers: authHeaders(apiKey),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0].key).toBe('fake');

    const one = await app.inject({
      method: 'GET',
      url: '/v1/providers/fake/capabilities',
      headers: authHeaders(apiKey),
    });
    expect(one.statusCode).toBe(200);

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/providers/nope/capabilities',
      headers: authHeaders(apiKey),
    });
    expect(missing.statusCode).toBe(404);
  });
});
