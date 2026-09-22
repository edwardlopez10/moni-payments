import { describe, expect, it } from 'vitest';

import { EnvSecretsProvider } from '../../../../src/platform/secrets/env-provider';
import {
  FAKE_SIGNATURE_HEADER,
  FakePaymentProvider,
  FakeScenario,
  signFakeWebhook,
} from '../../../../src/providers/fake';
import { testProviderContext, testWebhookContext } from '../../../helpers/provider-context';

describe('FakePaymentProvider webhooks', () => {
  it('verifies a correctly signed body and rejects tampering or missing headers', async () => {
    process.env.FAKE_WEBHOOK_SECRET = 'super-secret-value';
    const secrets = new EnvSecretsProvider();
    const provider = new FakePaymentProvider({
      secrets,
      webhookSecretRef: 'env://FAKE_WEBHOOK_SECRET',
    });
    const secret = await secrets.resolve('env://FAKE_WEBHOOK_SECRET');
    const rawBody = Buffer.from(JSON.stringify({ kind: 'PAYMENT', providerEventId: 'e1' }));
    const signed = {
      rawBody,
      headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, secret) },
      query: {},
    };
    const ctx = testWebhookContext({ signingSecret: secret });

    expect((await provider.verifyWebhook(signed, ctx)).verified).toBe(true);

    const tampered = {
      rawBody: Buffer.from(rawBody.toString('utf8').replace('e1', 'e2')),
      headers: signed.headers,
      query: {},
    };
    expect((await provider.verifyWebhook(tampered, ctx)).verified).toBe(false);

    const missing = { rawBody, headers: {}, query: {} };
    expect((await provider.verifyWebhook(missing, ctx)).verified).toBe(false);
  });

  it('parses the same providerEventId twice from the same body', async () => {
    const provider = new FakePaymentProvider({ signingSecret: 'sec' });
    const request = await provider.signWebhookPayload({
      kind: 'PAYMENT',
      providerEventId: 'stable-event',
      providerEventType: 'payment.paid',
      providerPaymentId: 'fake_pay_1',
      status: 'PAID',
    });
    const first = await provider.parseWebhook(request);
    const second = await provider.parseWebhook(request);
    expect(first.providerEventId).toBe('stable-event');
    expect(second.providerEventId).toBe(first.providerEventId);
  });

  it('returns UNKNOWN for unrecognised bodies rather than throwing', async () => {
    const provider = new FakePaymentProvider({ signingSecret: 'sec' });
    const request = await provider.signWebhookPayload({ hello: 'world' });
    const event = await provider.parseWebhook(request);
    expect(event.kind).toBe('UNKNOWN');
  });

  it('emits duplicate and out-of-order webhook sequences', async () => {
    const provider = new FakePaymentProvider({ signingSecret: 'sec' });
    const ctx = testProviderContext();

    await provider.createPayment(
      {
        paymentId: 'pay_dup',
        amount: { amount: 100, currency: 'USD' },
        customerReference: 'c',
        idempotencyKey: 'dup',
        metadata: { fakeScenario: FakeScenario.DUPLICATE_WEBHOOK },
      },
      ctx,
    );
    const duplicates = await provider.drainSignedWebhooks();
    expect(duplicates).toHaveLength(2);
    const ids = await Promise.all(
      duplicates.map(async (request) => (await provider.parseWebhook(request)).providerEventId),
    );
    expect(ids[0]).toBe(ids[1]);

    provider.state.reset();
    await provider.createPayment(
      {
        paymentId: 'pay_ooo',
        amount: { amount: 100, currency: 'USD' },
        customerReference: 'c',
        idempotencyKey: 'ooo',
        metadata: { fakeScenario: FakeScenario.OUT_OF_ORDER_WEBHOOK },
      },
      ctx,
    );
    const ordered = await provider.drainSignedWebhooks();
    expect(ordered).toHaveLength(2);
    const statuses = await Promise.all(
      ordered.map(async (request) => {
        const event = await provider.parseWebhook(request);
        return event.kind === 'PAYMENT' ? event.status : null;
      }),
    );
    expect(statuses).toEqual(['PAID', 'PROCESSING']);
  });
});
