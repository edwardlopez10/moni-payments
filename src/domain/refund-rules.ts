import { AppError, ErrorCode } from './errors';
import { PaymentStatus } from './payment-status';

export function refundableAmount(input: {
  status: string;
  amount: number;
  refundedAmount: number;
}): number {
  if (
    input.status !== PaymentStatus.PAID &&
    input.status !== PaymentStatus.PARTIALLY_REFUNDED
  ) {
    return 0;
  }
  return Math.max(0, input.amount - input.refundedAmount);
}

export function assertRefundAllowed(input: {
  status: string;
  amount: number;
  refundedAmount: number;
  refundAmount: number;
  supportsPartialRefunds: boolean;
}): { isPartial: boolean; nextStatus: typeof PaymentStatus.PARTIALLY_REFUNDED | typeof PaymentStatus.REFUNDED } {
  if (
    input.status !== PaymentStatus.PAID &&
    input.status !== PaymentStatus.PARTIALLY_REFUNDED
  ) {
    throw new AppError(
      ErrorCode.REFUND_NOT_ALLOWED,
      `Payment status ${input.status} does not allow refunds.`,
    );
  }

  const remaining = input.amount - input.refundedAmount;
  if (input.refundAmount <= 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Refund amount must be greater than zero.', {
      details: [{ field: 'amount', issue: 'must be a positive integer in minor units' }],
    });
  }
  if (input.refundAmount > remaining) {
    throw new AppError(
      ErrorCode.REFUND_NOT_ALLOWED,
      'Refund amount exceeds the refundable remainder.',
      {
        details: [
          {
            field: 'amount',
            issue: `must be at most ${remaining} minor units`,
          },
        ],
      },
    );
  }

  const isPartial = input.refundAmount < remaining;
  if (isPartial && !input.supportsPartialRefunds) {
    throw new AppError(
      ErrorCode.REFUND_NOT_ALLOWED,
      'Provider does not support partial refunds.',
    );
  }

  const nextRefunded = input.refundedAmount + input.refundAmount;
  const nextStatus =
    nextRefunded >= input.amount
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;

  return { isPartial, nextStatus };
}
