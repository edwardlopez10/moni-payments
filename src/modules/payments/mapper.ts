import type { Payment, PaymentAttempt, Prisma, Refund } from '@prisma/client';

import { refundableAmount } from '../../domain/refund-rules';
import { iso } from '../../platform/http/schemas';
import type { PaymentResponse } from './schema';

function asStringRecord(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

export function toAttemptSummary(attempt: PaymentAttempt) {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    failureCode: attempt.failureCode,
    createdAt: iso(attempt.createdAt)!,
  };
}

export function toRefundSummary(refund: Refund) {
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
  };
}

export function toPaymentResponse(
  row: Payment & { attempts?: PaymentAttempt[]; refunds?: Refund[] },
  options: { includeCollections?: boolean; latestAttemptOnly?: boolean } = {},
): PaymentResponse {
  const attempts = row.attempts ?? [];
  const latest = attempts.length > 0 ? attempts[attempts.length - 1]! : null;

  const response: PaymentResponse = {
    id: row.id,
    organizationId: row.organizationId,
    sourceProduct: row.sourceProduct,
    externalReference: row.externalReference,
    customerReference: row.customerReference,
    amount: row.amount,
    currency: row.currency,
    refundedAmount: row.refundedAmount,
    refundableAmount: refundableAmount({
      status: row.status,
      amount: row.amount,
      refundedAmount: row.refundedAmount,
    }),
    status: row.status,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId,
    description: row.description,
    checkoutUrl: row.checkoutUrl,
    metadata: asStringRecord(row.metadata),
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    authorizedAt: iso(row.authorizedAt),
    paidAt: iso(row.paidAt),
    failedAt: iso(row.failedAt),
  };

  if (options.includeCollections) {
    response.attempts = attempts.map(toAttemptSummary);
    response.refunds = (row.refunds ?? []).map(toRefundSummary);
  } else if (options.latestAttemptOnly !== false) {
    response.latestAttempt = latest ? toAttemptSummary(latest) : null;
  }

  return response;
}
