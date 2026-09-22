import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import { assertRefundAllowed, refundableAmount } from '../../../src/domain/refund-rules';

describe('refund rules', () => {
  it('computes refundable amount only for PAID and PARTIALLY_REFUNDED', () => {
    expect(refundableAmount({ status: 'PROCESSING', amount: 100, refundedAmount: 0 })).toBe(0);
    expect(refundableAmount({ status: 'PAID', amount: 100, refundedAmount: 25 })).toBe(75);
  });

  it('allows exact remainder and rejects one unit over', () => {
    const ok = assertRefundAllowed({
      status: 'PAID',
      amount: 100,
      refundedAmount: 0,
      refundAmount: 100,
      supportsPartialRefunds: true,
    });
    expect(ok.nextStatus).toBe('REFUNDED');

    expect(() =>
      assertRefundAllowed({
        status: 'PAID',
        amount: 100,
        refundedAmount: 0,
        refundAmount: 101,
        supportsPartialRefunds: true,
      }),
    ).toThrow(AppError);

    try {
      assertRefundAllowed({
        status: 'PENDING',
        amount: 100,
        refundedAmount: 0,
        refundAmount: 10,
        supportsPartialRefunds: true,
      });
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.REFUND_NOT_ALLOWED);
    }
  });
});
