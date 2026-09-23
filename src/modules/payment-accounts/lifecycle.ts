import type { PaymentAccountStatus } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';

const ALLOWED_TRANSITIONS: Record<PaymentAccountStatus, readonly PaymentAccountStatus[]> = {
  NOT_CONFIGURED: ['ONBOARDING'],
  ONBOARDING: ['PENDING_VERIFICATION'],
  PENDING_VERIFICATION: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED', 'DISABLED'],
  SUSPENDED: ['ACTIVE', 'DISABLED'],
  DISABLED: [],
  REJECTED: [],
};

export function assertPaymentAccountTransition(
  from: PaymentAccountStatus,
  to: PaymentAccountStatus,
): void {
  if (from === to) {
    return;
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new AppError(
      ErrorCode.INVALID_PAYMENT_STATE,
      `Cannot transition payment account from ${from} to ${to}.`,
      { details: [{ field: 'status', issue: `illegal transition ${from} -> ${to}` }] },
    );
  }
}

export function isTerminalPaymentAccountStatus(status: PaymentAccountStatus): boolean {
  return status === 'DISABLED' || status === 'REJECTED';
}
