import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FAKE_SIGNATURE_HEADER, signFakeWebhook } from '../../src/providers/fake';
import { verifyCallbackSignature } from '../../src/platform/events/signing';
import { setEventPublisherForTests, HttpEventPublisher } from '../../src/platform/events/publisher';
import { authHeaders, createTestApp, seedOrgWithFakeAccount } from '../helpers/api';

describe('webhooks and events', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let prisma: Awaited<ReturnType<typeof createTestApp>>['prisma'];
  let apiKey: string;
  let organizationId: string;
  const webhookSecret = 'test-fake-webhook-secret';

  beforeAll(async () => {
    process.env.FAKE_PROVIDER_WEBHOOK_SECRET = webhookSecret;
    process.env.EVENT_CALLBACK_SECRET = 'callback-secret';
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    apiKey = ctx.apiKey;
    organizationId = await seedOrgWithFakeAccount(app, apiKey, 'wh-org');
  });

  afterAll(async () => {
    setEventPublisherForTests(undefined);
    await app.close();
    await prisma.$disconnect();
  });

  function signedBody(payload: Record<string, unknown>) {
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    return {
      rawBody,
      headers: {
        'content-type': 'application/json',
        [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, webhookSecret),
      },
    };
  }

  it('accepts a valid signed webhook and rejects tampered or missing signatures', async () => {
    const payment = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'wh-pay-1'),
      payload: {
        organizationId,
        externalReference: 'wh-fee-1',
        customerReference: 'c1',
        amount: 1000,
        currency: 'USD',
        metadata: { fakeScenario: 'processing' },
      },
    });
    const providerPaymentId = payment.json().providerPaymentId as string;

    const { rawBody, headers } = signedBody({
      kind: 'PAYMENT',
      providerEventId: 'evt-paid-1',
      providerEventType: 'payment.paid',
      providerPaymentId,
      status: 'PAID',
      amount: { amount: 1000, currency: 'USD' },
    });

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers,
      payload: rawBody,
    });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().duplicate).toBe(false);
    expect(await prisma.webhookEvent.count()).toBe(1);

    const tampered = Buffer.from(rawBody.toString('utf8').replace('PAID', 'FAIL'));
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers: {
        'content-type': 'application/json',
        [FAKE_SIGNATURE_HEADER]: headers[FAKE_SIGNATURE_HEADER]!,
      },
      payload: tampered,
    });
    expect(bad.statusCode).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(1);

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers: { 'content-type': 'application/json' },
      payload: rawBody,
    });
    expect(missing.statusCode).toBe(401);
  });

  it('returns duplicate:true for the same providerEventId without reprocessing', async () => {
    const { rawBody, headers } = signedBody({
      kind: 'PAYMENT',
      providerEventId: 'evt-dup-1',
      providerEventType: 'payment.paid',
      providerPaymentId: 'unknown_pay',
      status: 'PAID',
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers,
      payload: rawBody,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers,
      payload: rawBody,
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().duplicate).toBe(true);
    expect(second.json().eventId).toBe(first.json().eventId);
  });

  it('returns 404 for unknown providers', async () => {
    const { rawBody, headers } = signedBody({ kind: 'UNKNOWN', providerEventId: 'x' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/nope',
      headers,
      payload: rawBody,
    });
    expect(response.statusCode).toBe(404);
  });

  it('processes paid webhooks, ignores stale and unknown payments', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'wh-pay-2'),
      payload: {
        organizationId,
        externalReference: 'wh-fee-2',
        customerReference: 'c1',
        amount: 2500,
        currency: 'USD',
        metadata: { fakeScenario: 'processing' },
      },
    });
    const paymentId = created.json().id as string;
    const providerPaymentId = created.json().providerPaymentId as string;

    const paid = signedBody({
      kind: 'PAYMENT',
      providerEventId: 'evt-process-paid',
      providerEventType: 'payment.paid',
      providerPaymentId,
      status: 'PAID',
    });
    const ingested = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers: paid.headers,
      payload: paid.rawBody,
    });
    await app.dispatcher.tick();

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(row.status).toBe('PAID');
    expect(row.paidAt).toBeTruthy();
    const webhook = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: ingested.json().eventId },
    });
    expect(webhook.processingStatus).toBe('PROCESSED');
    expect(
      await prisma.outboxEvent.count({
        where: { resourceId: paymentId, eventType: 'payment.paid' },
      }),
    ).toBeGreaterThan(0);

    const stale = signedBody({
      kind: 'PAYMENT',
      providerEventId: 'evt-stale-processing',
      providerEventType: 'payment.processing',
      providerPaymentId,
      status: 'PROCESSING',
    });
    const staleIngest = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers: stale.headers,
      payload: stale.rawBody,
    });
    await app.dispatcher.tick();
    const staleRow = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: staleIngest.json().eventId },
    });
    expect(staleRow.processingStatus).toBe('IGNORED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      'PAID',
    );

    const unknown = signedBody({
      kind: 'PAYMENT',
      providerEventId: 'evt-unknown-pay',
      providerEventType: 'payment.paid',
      providerPaymentId: 'does-not-exist',
      status: 'PAID',
    });
    const unknownIngest = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers: unknown.headers,
      payload: unknown.rawBody,
    });
    await app.dispatcher.tick();
    expect(
      (
        await prisma.webhookEvent.findUniqueOrThrow({
          where: { id: unknownIngest.json().eventId },
        })
      ).processingStatus,
    ).toBe('IGNORED');
  });

  it('delivers outbox events with a verifiable signature and retries failures', async () => {
    const deliveries: Array<{
      eventId: string;
      signature: string;
      attempt: string;
      body: string;
    }> = [];
    let failOnce = true;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        deliveries.push({
          eventId: String(req.headers['x-moniveo-event-id']),
          signature: String(req.headers['x-moniveo-signature']),
          attempt: String(req.headers['x-moniveo-delivery-attempt']),
          body,
        });
        if (failOnce) {
          failOnce = false;
          res.statusCode = 500;
          res.end('nope');
          return;
        }
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected port');
    }
    const callbackUrl = `http://127.0.0.1:${address.port}/callback`;

    await prisma.eventSubscription.create({
      data: {
        sourceProduct: 'RESIDENT',
        organizationId,
        url: callbackUrl,
        secretRef: 'env://EVENT_CALLBACK_SECRET',
        eventTypes: [],
        active: true,
      },
    });

    setEventPublisherForTests(new HttpEventPublisher());

    const created = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'wh-pay-3'),
      payload: {
        organizationId,
        externalReference: 'wh-fee-3',
        customerReference: 'c1',
        amount: 500,
        currency: 'USD',
        metadata: { fakeScenario: 'instant_success' },
      },
    });
    const paymentId = created.json().id as string;

    // Isolate the paid event so the one-shot failure applies to it.
    await prisma.outboxEvent.deleteMany({
      where: { resourceId: paymentId, eventType: { not: 'payment.paid' } },
    });
    await prisma.outboxEvent.updateMany({
      where: { resourceId: paymentId, eventType: 'payment.paid', status: 'PENDING' },
      data: { nextAttemptAt: new Date(0) },
    });

    await app.dispatcher.tick();
    const failed = await prisma.outboxEvent.findFirst({
      where: { resourceId: paymentId, eventType: 'payment.paid' },
    });
    expect(failed?.status).toBe('FAILED');
    expect(failed?.attempts).toBe(1);

    await prisma.outboxEvent.update({
      where: { id: failed!.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await app.dispatcher.tick();

    const delivered = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: failed!.id } });
    expect(delivered.status).toBe('DELIVERED');
    expect(deliveries.length).toBe(2);
    expect(deliveries[0]!.eventId).toBe(deliveries[1]!.eventId);
    expect(deliveries[0]!.attempt).toBe('1');
    expect(deliveries[1]!.attempt).toBe('2');
    expect(
      verifyCallbackSignature(
        deliveries[1]!.body,
        deliveries[1]!.signature,
        'callback-secret',
      ),
    ).toBe(true);

    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('does not double-claim the same webhook under concurrent ticks', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'wh-pay-4'),
      payload: {
        organizationId,
        externalReference: 'wh-fee-4',
        customerReference: 'c1',
        amount: 100,
        currency: 'USD',
        metadata: { fakeScenario: 'processing' },
      },
    });
    const providerPaymentId = created.json().providerPaymentId as string;
    const signed = signedBody({
      kind: 'PAYMENT',
      providerEventId: 'evt-concurrent',
      providerEventType: 'payment.paid',
      providerPaymentId,
      status: 'PAID',
    });
    await app.inject({
      method: 'POST',
      url: '/v1/webhooks/fake',
      headers: signed.headers,
      payload: signed.rawBody,
    });

    await Promise.all(Array.from({ length: 20 }, () => app.dispatcher.tick()));
    const payment = await prisma.payment.findFirstOrThrow({
      where: { externalReference: 'wh-fee-4' },
    });
    expect(payment.status).toBe('PAID');
    const outboxPaid = await prisma.outboxEvent.count({
      where: { resourceId: payment.id, eventType: 'payment.paid' },
    });
    expect(outboxPaid).toBe(1);
  });
});

describe('event payload schemas', () => {
  it('builds versioned payment and refund payloads', async () => {
    const { buildPaymentEventPayload, buildRefundEventPayload, EVENT_SCHEMA_VERSION } =
      await import('../../src/domain/events');
    const payment = buildPaymentEventPayload({
      eventType: 'payment.paid',
      paymentId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      status: 'PAID',
      amount: 100,
      currency: 'USD',
      externalReference: 'x',
    });
    expect(payment.version).toBe(EVENT_SCHEMA_VERSION);

    const refund = buildRefundEventPayload({
      eventType: 'payment.refunded',
      refundId: '33333333-3333-4333-8333-333333333333',
      paymentId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      status: 'REFUNDED',
      amount: 100,
      currency: 'USD',
    });
    expect(refund.version).toBe(EVENT_SCHEMA_VERSION);
  });
});
