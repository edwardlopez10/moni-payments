import { AppError, ErrorCode } from './errors';

export const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  CHARGEBACK: 'CHARGEBACK',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['PROCESSING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
  PROCESSING: ['AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['PAID', 'FAILED', 'CANCELLED'],
  PAID: ['PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK'],
  REFUNDED: ['CHARGEBACK'],
  FAILED: ['PROCESSING'],
  CANCELLED: [],
  CHARGEBACK: [],
};

export interface PaymentStatusUpdate {
  status: PaymentStatus;
  authorizedAt?: Date;
  paidAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      ErrorCode.INVALID_PAYMENT_STATE,
      `Cannot transition payment from ${from} to ${to}.`,
    );
  }
}

/**
 * Pure status transition. Returns the fields a caller should persist.
 * Does not touch the database — persistence and outbox writes belong to the service layer.
 */
export function transitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
  now: Date = new Date(),
): PaymentStatusUpdate {
  assertTransition(from, to);

  const update: PaymentStatusUpdate = { status: to };

  switch (to) {
    case PaymentStatus.AUTHORIZED:
      update.authorizedAt = now;
      break;
    case PaymentStatus.PAID:
      update.paidAt = now;
      break;
    case PaymentStatus.FAILED:
      update.failedAt = now;
      break;
    case PaymentStatus.CANCELLED:
      update.cancelledAt = now;
      break;
    default:
      break;
  }

  return update;
}

export function isTerminalStatus(status: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
