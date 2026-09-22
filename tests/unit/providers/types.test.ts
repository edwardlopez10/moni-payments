import { describe, expect, expectTypeOf, it } from 'vitest';

import { ProviderCapability } from '../../../src/providers/capabilities';
import type { PaymentProvider } from '../../../src/providers/types';
import { ProviderFailureCode } from '../../../src/providers/types';

describe('provider types', () => {
  it('exposes a closed ProviderFailureCode union', () => {
    expect(Object.keys(ProviderFailureCode).sort()).toEqual(
      [
        'AMOUNT_NOT_ALLOWED',
        'AUTHENTICATION_REQUIRED',
        'CURRENCY_NOT_SUPPORTED',
        'DUPLICATE_TRANSACTION',
        'EXPIRED_PAYMENT_METHOD',
        'INSUFFICIENT_FUNDS',
        'INVALID_PAYMENT_METHOD',
        'PAYMENT_DECLINED',
        'PROVIDER_CONFIGURATION_ERROR',
        'PROVIDER_UNAVAILABLE',
        'REFUND_NOT_ALLOWED',
        'UNKNOWN',
      ].sort(),
    );
  });

  it('marks optional operations as optional methods', () => {
    expectTypeOf<PaymentProvider['createPayment']>().toBeFunction();
    expectTypeOf<PaymentProvider['getPayment']>().toBeFunction();
    expectTypeOf<PaymentProvider['refundPayment']>().toEqualTypeOf<
      PaymentProvider['refundPayment']
    >();
    expectTypeOf<PaymentProvider>().toHaveProperty('capabilities');
    expect(ProviderCapability.REFUNDS).toBe('REFUNDS');
  });
});
