import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import {
  ALLOWED_TRANSITIONS,
  PaymentStatus,
  canTransition,
  isTerminalStatus,
  transitionPayment,
} from '../../../src/domain/payment-status';

const ALL_STATUSES = Object.values(PaymentStatus);

describe('payment status machine', () => {
  it('allows every legal transition and rejects every illegal pair', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const allowed = canTransition(from, to);
        if (allowed) {
          expect(() => transitionPayment(from, to)).not.toThrow();
        } else {
          expect(() => transitionPayment(from, to)).toThrow(AppError);
          try {
            transitionPayment(from, to);
          } catch (error) {
            expect((error as AppError).code).toBe(ErrorCode.INVALID_PAYMENT_STATE);
          }
        }
      }
    }
  });

  it('treats CANCELLED and CHARGEBACK as terminal', () => {
    expect(isTerminalStatus(PaymentStatus.CANCELLED)).toBe(true);
    expect(isTerminalStatus(PaymentStatus.CHARGEBACK)).toBe(true);
    expect(ALLOWED_TRANSITIONS.CANCELLED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.CHARGEBACK).toEqual([]);
  });

  it('sets only the matching timestamp for each transition', () => {
    const now = new Date('2026-09-21T12:00:00.000Z');

    expect(transitionPayment(PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, now)).toEqual({
      status: PaymentStatus.AUTHORIZED,
      authorizedAt: now,
    });
    expect(transitionPayment(PaymentStatus.PROCESSING, PaymentStatus.PAID, now)).toEqual({
      status: PaymentStatus.PAID,
      paidAt: now,
    });
    expect(transitionPayment(PaymentStatus.PENDING, PaymentStatus.FAILED, now)).toEqual({
      status: PaymentStatus.FAILED,
      failedAt: now,
    });
    expect(transitionPayment(PaymentStatus.PENDING, PaymentStatus.CANCELLED, now)).toEqual({
      status: PaymentStatus.CANCELLED,
      cancelledAt: now,
    });
    expect(transitionPayment(PaymentStatus.PAID, PaymentStatus.REFUNDED, now)).toEqual({
      status: PaymentStatus.REFUNDED,
    });
  });

  it('allows FAILED -> PROCESSING for retries', () => {
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.PROCESSING)).toBe(true);
    expect(transitionPayment(PaymentStatus.FAILED, PaymentStatus.PROCESSING).status).toBe(
      PaymentStatus.PROCESSING,
    );
  });
});
