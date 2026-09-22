import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  authHeaders,
  closeTestApp,
  createTestApp,
  type TestAppContext,
} from '../helpers/app';

describe('e2e payment lifecycle', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    process.env.FAKE_PROVIDER_WEBHOOK_SECRET = 'test-fake-webhook-secret';
    process.env.EVENT_CALLBACK_SECRET = 'test-callback-secret';
    ctx = await createTestApp({ withBackend: true });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('runs the milestone-1 demonstration path end to end', async () => {
    const org = await ctx.app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(ctx.apiKey, 'e2e-org'),
      payload: { externalId: 'e2e-condo', name: 'E2E Condo' },
    });
    expect(org.statusCode).toBe(201);
    const organizationId = org.json().id as string;

    const account = await ctx.app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(ctx.apiKey, 'e2e-acct'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'E2E-MERCHANT',
        isDefault: true,
        credentialRefs: {
          apiKey: 'env://FAKE_PROVIDER_API_KEY',
          webhookSecret: 'env://FAKE_PROVIDER_WEBHOOK_SECRET',
        },
      },
    });
    expect(account.statusCode).toBe(201);

    const createPayment = await ctx.app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ctx.apiKey, 'e2e-pay-1'),
      payload: {
        organizationId,
        externalReference: 'e2e-fee-1',
        customerReference: 'cust-42',
        amount: 8500,
        currency: 'USD',
        metadata: { fakeScenario: 'success' },
      },
    });
    expect(createPayment.statusCode).toBe(201);
    const paymentId = createPayment.json().id as string;
    expect(createPayment.json().status).toBe('PROCESSING');

    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ctx.apiKey, 'e2e-pay-1'),
      payload: {
        organizationId,
        externalReference: 'e2e-fee-1',
        customerReference: 'cust-42',
        amount: 8500,
        currency: 'USD',
        metadata: { fakeScenario: 'success' },
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json().id).toBe(paymentId);

    const rowsBefore = await ctx.prisma.payment.count({
      where: { organizationId, externalReference: 'e2e-fee-1' },
    });
    expect(rowsBefore).toBe(1);

    // Flush payment.created so the next callback is payment.paid.
    await ctx.app.dispatcher.tick();
    ctx.backend!.reset();

    const succeed = await ctx.app.inject({
      method: 'POST',
      url: `/dev/fake-provider/payments/${paymentId}/succeed`,
    });
    expect(succeed.statusCode).toBe(202);

    const paid = await ctx.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(ctx.apiKey),
    });
    expect(paid.json().status).toBe('PAID');

    await ctx.app.dispatcher.tick();
    const paidCallbacks = await ctx.backend!.waitForCallbacks(1);
    expect(paidCallbacks[0]?.verified).toBe(true);
    expect(JSON.stringify(paidCallbacks[0]?.body)).toContain('payment.paid');

    const callbackCountAfterPaid = ctx.backend!.callbacks.length;
    const dup = await ctx.app.inject({
      method: 'POST',
      url: `/dev/fake-provider/payments/${paymentId}/send-duplicate-webhook`,
    });
    expect(dup.statusCode).toBe(202);
    expect(dup.json().duplicate).toBe(true);
    await ctx.app.dispatcher.tick();
    expect(ctx.backend!.callbacks.length).toBe(callbackCountAfterPaid);

    const refund = await ctx.app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/refunds`,
      headers: authHeaders(ctx.apiKey, 'e2e-rfnd'),
      payload: { amount: 8500, reason: 'requested_by_customer' },
    });
    expect(refund.statusCode).toBe(201);

    const afterRefund = await ctx.app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(ctx.apiKey),
    });
    expect(afterRefund.json().status).toBe('REFUNDED');

    await ctx.app.dispatcher.tick();
    await ctx.backend!.waitForCallbacks(callbackCountAfterPaid + 1);
    const last = ctx.backend!.callbacks.at(-1)!;
    expect(last.verified).toBe(true);
    expect(JSON.stringify(last.body)).toMatch(/payment\.refunded/);
  });
});
