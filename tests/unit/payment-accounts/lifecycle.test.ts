import type { PaymentAccountStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import { assertPaymentAccountTransition } from '../../../src/modules/payment-accounts/lifecycle';

const STATUSES: PaymentAccountStatus[] = [
  'NOT_CONFIGURED',
  'ONBOARDING',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
  'REJECTED',
];

const ALLOWED = new Set([
  'NOT_CONFIGURED>ONBOARDING',
  'ONBOARDING>PENDING_VERIFICATION',
  'PENDING_VERIFICATION>ACTIVE',
  'PENDING_VERIFICATION>REJECTED',
  'ACTIVE>SUSPENDED',
  'ACTIVE>DISABLED',
  'SUSPENDED>ACTIVE',
  'SUSPENDED>DISABLED',
]);

describe('payment account lifecycle', () => {
  it('allows only the documented transitions and refuses every other pair', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const transition = () => assertPaymentAccountTransition(from, to);
        if (from === to || ALLOWED.has(`${from}>${to}`)) {
          expect(transition).not.toThrow();
          continue;
        }
        expect(transition).toThrow(AppError);
        try {
          transition();
        } catch (error) {
          expect((error as AppError).code).toBe(ErrorCode.INVALID_PAYMENT_STATE);
        }
      }
    }
  });
});
