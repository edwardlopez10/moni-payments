import { describe, expect, it } from 'vitest';

import { FakePaymentProvider, FakeScenario } from '../../../../src/providers/fake';
import { isProviderError } from '../../../../src/providers/errors';
import { ProviderFailureCode } from '../../../../src/providers/types';
import { testProviderContext } from '../../../helpers/provider-context';

describe('FakePaymentProvider payments', () => {
  const ctx = testProviderContext();

  function createProvider() {
    return new FakePaymentProvider({ signingSecret: 'test-secret' });
  }

  it('defaults to PROCESSING with a checkoutUrl for success', async () => {
    const provider = createProvider();
    const result = await provider.createPayment(
      {
        paymentId: 'pay_1',
        amount: { amount: 8500, currency: 'USD' },
        customerReference: 'cust_1',
        idempotencyKey: 'idem-1',
        metadata: {},
      },
      ctx,
    );
    expect(result.status).toBe('PROCESSING');
    expect(result.checkoutUrl).toMatch(/^https:\/\/checkout\.fake\.test\//);
    expect(result.providerPaymentId).toMatch(/^fake_pay_/);
  });

  it('returns PAID synchronously for instant_success', async () => {
    const provider = createProvider();
    const result = await provider.createPayment(
      {
        paymentId: 'pay_2',
        amount: { amount: 100, currency: 'USD' },
        customerReference: 'cust_1',
        idempotencyKey: 'idem-2',
        metadata: { fakeScenario: FakeScenario.INSTANT_SUCCESS },
      },
      ctx,
    );
    expect(result.status).toBe('PAID');
  });

  it('maps declined and insufficient_funds failures', async () => {
    const provider = createProvider();
    const declined = await provider.createPayment(
      {
        paymentId: 'pay_3',
        amount: { amount: 100, currency: 'USD' },
        customerReference: 'cust_1',
        idempotencyKey: 'idem-3',
        metadata: { fakeScenario: FakeScenario.DECLINED },
      },
      ctx,
    );
    expect(declined.status).toBe('FAILED');
    expect(declined.failure?.code).toBe(ProviderFailureCode.PAYMENT_DECLINED);

    const funds = await provider.createPayment(
      {
        paymentId: 'pay_4',
        amount: { amount: 100, currency: 'USD' },
        customerReference: 'cust_1',
        idempotencyKey: 'idem-4',
        metadata: { fakeScenario: FakeScenario.INSUFFICIENT_FUNDS },
      },
      ctx,
    );
    expect(funds.failure?.code).toBe(ProviderFailureCode.INSUFFICIENT_FUNDS);
  });

  it('keeps processing scenario in PROCESSING with no queued paid webhook', async () => {
    const provider = createProvider();
    const result = await provider.createPayment(
      {
        paymentId: 'pay_5',
        amount: { amount: 100, currency: 'USD' },
        customerReference: 'cust_1',
        idempotencyKey: 'idem-5',
        metadata: { fakeScenario: FakeScenario.PROCESSING },
      },
      ctx,
    );
    expect(result.status).toBe('PROCESSING');
    const webhooks = await provider.drainSignedWebhooks();
    expect(webhooks).toHaveLength(0);
  });

  it('queues a delayed paid webhook for delayed_success', async () => {
    let now = 1_000;
    const provider = new FakePaymentProvider({
      signingSecret: 'test-secret',
      now: () => now,
    });
    await provider.createPayment(
      {
        paymentId: 'pay_6',
        amount: { amount: 100, currency: 'USD' },
        customerReference: 'cust_1',
        idempotencyKey: 'idem-6',
        metadata: { fakeScenario: FakeScenario.DELAYED_SUCCESS, fakeDelayMs: '50' },
      },
      ctx,
    );
    expect(await provider.drainSignedWebhooks()).toHaveLength(0);
    now = 1_060;
    expect(await provider.drainSignedWebhooks()).toHaveLength(1);
  });

  it('throws ProviderError for provider_unavailable', async () => {
    const provider = createProvider();
    await expect(
      provider.createPayment(
        {
          paymentId: 'pay_7',
          amount: { amount: 100, currency: 'USD' },
          customerReference: 'cust_1',
          idempotencyKey: 'idem-7',
          metadata: { fakeScenario: FakeScenario.PROVIDER_UNAVAILABLE },
        },
        ctx,
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isProviderError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ProviderFailureCode.PROVIDER_UNAVAILABLE);
      return true;
    });
  });

  it('is idempotent on idempotencyKey and unique across keys', async () => {
    const provider = createProvider();
    const input = {
      paymentId: 'pay_8',
      amount: { amount: 100, currency: 'USD' },
      customerReference: 'cust_1',
      idempotencyKey: 'same-key',
      metadata: { fakeScenario: FakeScenario.INSTANT_SUCCESS },
    };
    const first = await provider.createPayment(input, ctx);
    const second = await provider.createPayment(input, ctx);
    expect(second.providerPaymentId).toBe(first.providerPaymentId);

    const other = await provider.createPayment(
      { ...input, paymentId: 'pay_9', idempotencyKey: 'other-key' },
      ctx,
    );
    expect(other.providerPaymentId).not.toBe(first.providerPaymentId);
  });

  it('throws ProviderError from getPayment for unknown ids', async () => {
    const provider = createProvider();
    await expect(provider.getPayment('missing', ctx)).rejects.toSatisfy((error: unknown) =>
      isProviderError(error),
    );
  });
});
