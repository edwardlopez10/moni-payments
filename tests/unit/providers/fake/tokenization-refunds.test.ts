import { describe, expect, it } from 'vitest';

import { FakePaymentProvider, FakeScenario } from '../../../../src/providers/fake';
import { isProviderError } from '../../../../src/providers/errors';
import { ProviderFailureCode } from '../../../../src/providers/types';
import { testProviderContext } from '../../../helpers/provider-context';

const PAN_SHAPED = /\b(?:\d[ -]*?){13,19}\b/;

describe('FakePaymentProvider tokenization and refunds', () => {
  const ctx = testProviderContext();

  it('tokenizes a setup token without returning PAN-shaped values', async () => {
    const provider = new FakePaymentProvider();
    const result = await provider.createPaymentMethod(
      {
        organizationId: ctx.organizationId,
        customerReference: 'cust_1',
        setupToken: provider.createSetupToken(),
        metadata: {},
      },
      ctx,
    );
    expect(result.last4).toMatch(/^\d{4}$/);
    expect(result.providerPaymentMethodId).toMatch(/^fake_pm_/);
    expect(JSON.stringify(result)).not.toMatch(PAN_SHAPED);
  });

  it('charges a stored payment method', async () => {
    const provider = new FakePaymentProvider();
    const method = await provider.createPaymentMethod(
      {
        organizationId: ctx.organizationId,
        customerReference: 'cust_1',
        setupToken: provider.createSetupToken(),
        metadata: {},
      },
      ctx,
    );
    const payment = await provider.chargePaymentMethod(
      {
        paymentId: 'pay_tok',
        amount: { amount: 2500, currency: 'USD' },
        customerReference: 'cust_1',
        providerPaymentMethodId: method.providerPaymentMethodId,
        idempotencyKey: 'charge-1',
        metadata: {},
      },
      ctx,
    );
    expect(payment.status).toBe('PAID');
    expect(payment.amount.amount).toBe(2500);
  });

  it('supports full and partial refunds and rejects over-refunds', async () => {
    const provider = new FakePaymentProvider();
    const created = await provider.createPayment(
      {
        paymentId: 'pay_rf',
        amount: { amount: 1000, currency: 'USD' },
        customerReference: 'cust_1',
        idempotencyKey: 'rf-create',
        metadata: { fakeScenario: FakeScenario.INSTANT_SUCCESS },
      },
      ctx,
    );

    const partial = await provider.refundPayment!(
      {
        refundId: 'ref_1',
        providerPaymentId: created.providerPaymentId,
        amount: { amount: 400, currency: 'USD' },
        isFullRefund: false,
        idempotencyKey: 'rf-1',
      },
      ctx,
    );
    expect(partial.status).toBe('SUCCEEDED');
    expect(partial.providerRefundId).not.toBe(created.providerPaymentId);

    const full = await provider.refundPayment!(
      {
        refundId: 'ref_2',
        providerPaymentId: created.providerPaymentId,
        amount: { amount: 600, currency: 'USD' },
        isFullRefund: true,
        idempotencyKey: 'rf-2',
      },
      ctx,
    );
    expect(full.status).toBe('SUCCEEDED');

    await expect(
      provider.refundPayment!(
        {
          refundId: 'ref_3',
          providerPaymentId: created.providerPaymentId,
          amount: { amount: 1, currency: 'USD' },
          isFullRefund: false,
          idempotencyKey: 'rf-3',
        },
        ctx,
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isProviderError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ProviderFailureCode.REFUND_NOT_ALLOWED);
      return true;
    });
  });

  it('fails refunds under the refund_failure scenario', async () => {
    const provider = new FakePaymentProvider();
    const created = await provider.createPayment(
      {
        paymentId: 'pay_fail_rf',
        amount: { amount: 500, currency: 'USD' },
        customerReference: 'cust_1',
        idempotencyKey: 'rf-fail-create',
        metadata: { fakeScenario: FakeScenario.REFUND_FAILURE },
      },
      ctx,
    );
    await provider.simulate(created.providerPaymentId, 'PAID');

    await expect(
      provider.refundPayment!(
        {
          refundId: 'ref_x',
          providerPaymentId: created.providerPaymentId,
          amount: { amount: 500, currency: 'USD' },
          isFullRefund: true,
          idempotencyKey: 'rf-fail',
        },
        ctx,
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isProviderError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ProviderFailureCode.REFUND_NOT_ALLOWED);
      return true;
    });
  });
});
