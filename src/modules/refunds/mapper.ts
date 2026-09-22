import type { Refund } from '@prisma/client';

import { refundableAmount } from '../../domain/refund-rules';
import { iso } from '../../platform/http/schemas';
import type { RefundResponse } from './schema';

export function toRefundResponse(
  refund: Refund,
  payment: { status: string; amount: number; refundedAmount: number },
): RefundResponse {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    amount: refund.amount,
    currency: refund.currency,
    isPartial: refund.isPartial,
    status: refund.status,
    provider: refund.provider,
    providerRefundId: refund.providerRefundId,
    reason: refund.reason,
    createdAt: iso(refund.createdAt)!,
    completedAt: iso(refund.completedAt),
    payment: {
      status: payment.status,
      refundedAmount: payment.refundedAmount,
      refundableAmount: refundableAmount({
        status: payment.status as never,
        amount: payment.amount,
        refundedAmount: payment.refundedAmount,
      }),
    },
  };
}
