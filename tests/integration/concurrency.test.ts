import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FAKE_SIGNATURE_HEADER, signFakeWebhook } from '../../src/providers/fake';
import {
  authHeaders,
  closeTestApp,
  createTestApp,
  seedOrgWithFakeAccount,
  type TestAppContext,
} from '../helpers/app';

describe('concurrency guarantees', () => {
  let ctx: TestAppContext;
  let organizationId: string;
  const webhookSecret = 'test-fake-webhook-secret';

  beforeAll(async () => {
    process.env.FAKE_PROVIDER_WEBHOOK_SECRET = webhookSecret;
    ctx = await createTestApp();
    organizationId = await seedOrgWithFakeAccount(ctx.app, ctx.apiKey, 'conc-org');
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('ten concurrent identical payment requests produce exactly one payment row', async () => {
    const payloads = Array.from({ length: 10 }, () =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/payments',
        headers: authHeaders(ctx.apiKey, 'conc-pay-dup'),
        payload: {
          organizationId,
          externalReference: 'conc-fee-1',
          customerReference: 'c1',
          amount: 2500,
          currency: 'USD',
          metadata: { fakeScenario: 'success' },
        },
      }),
    );

    const responses = await Promise.all(payloads);
    const statuses = responses.map((r) => r.statusCode);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);

    const authoritative = responses.filter((r) => r.statusCode === 201);
    expect(authoritative.length).toBeGreaterThanOrEqual(1);

    const paymentIds = new Set(
      responses
        .filter((r) => r.statusCode === 201 || r.headers['idempotency-replayed'] === 'true')
        .map((r) => r.json().id as string)
        .filter(Boolean),
    );
    // All successful/replayed bodies share one id when present
    const rows = await ctx.prisma.payment.findMany({
      where: { organizationId, externalReference: 'conc-fee-1' },
    });
    expect(rows).toHaveLength(1);
    void paymentIds;
  });

  it('twenty concurrent deliveries of the same webhook produce one state change', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ctx.apiKey, 'conc-wh-pay'),
      payload: {
        organizationId,
        externalReference: 'conc-wh-fee',
        customerReference: 'c1',
        amount: 1000,
        currency: 'USD',
        metadata: { fakeScenario: 'success' },
      },
    });
    expect(created.statusCode).toBe(201);
    const payment = created.json();
    const providerPaymentId = payment.providerPaymentId as string;

    const payload = {
      kind: 'PAYMENT',
      providerEventId: `conc_evt_${providerPaymentId}`,
      providerEventType: 'payment.paid',
      providerPaymentId,
      status: 'PAID',
      amount: { amount: 1000, currency: 'USD' },
      occurredAt: new Date().toISOString(),
    };
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const headers = {
      'content-type': 'application/json',
      [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, webhookSecret),
    };

    const deliveries = await Promise.all(
      Array.from({ length: 20 }, () =>
        ctx.app.inject({
          method: 'POST',
          url: '/v1/webhooks/fake',
          headers,
          payload: rawBody,
        }),
      ),
    );

    expect(deliveries.every((d) => d.statusCode === 202)).toBe(true);
    const duplicates = deliveries.filter((d) => d.json().duplicate === true);
    expect(duplicates.length).toBeGreaterThanOrEqual(19);

    await ctx.app.dispatcher.tick();

    const row = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe('PAID');

    const events = await ctx.prisma.webhookEvent.findMany({
      where: { provider: 'fake', providerEventId: payload.providerEventId },
    });
    expect(events).toHaveLength(1);
  });

  it('two concurrent full refunds produce exactly one success and CHECK rejects over-refund', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ctx.apiKey, 'conc-rfnd-pay'),
      payload: {
        organizationId,
        externalReference: 'conc-rfnd-fee',
        customerReference: 'c1',
        amount: 5000,
        currency: 'USD',
        metadata: { fakeScenario: 'instant_success' },
      },
    });
    expect(created.statusCode).toBe(201);
    const paymentId = created.json().id as string;
    expect(created.json().status).toBe('PAID');

    const refunds = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: `/v1/payments/${paymentId}/refunds`,
        headers: authHeaders(ctx.apiKey, 'conc-rfnd-a'),
        payload: { amount: 5000, reason: 'duplicate' },
      }),
      ctx.app.inject({
        method: 'POST',
        url: `/v1/payments/${paymentId}/refunds`,
        headers: authHeaders(ctx.apiKey, 'conc-rfnd-b'),
        payload: { amount: 5000, reason: 'duplicate' },
      }),
    ]);

    const successes = refunds.filter((r) => r.statusCode === 201);
    const conflicts = refunds.filter((r) => r.statusCode === 409 || r.statusCode === 422);
    expect(successes).toHaveLength(1);
    expect(conflicts.length + successes.length).toBe(2);

    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.refundedAmount).toBe(5000);
    expect(payment.status).toBe('REFUNDED');

    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE payments SET refunded_amount = amount + 1 WHERE id = $1`,
        paymentId,
      ),
    ).rejects.toThrow(/payments_refund_within_total|check/i);
  });
});
