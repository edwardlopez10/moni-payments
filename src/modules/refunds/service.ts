import type { Prisma } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import { assertRefundAllowed, refundableAmount } from '../../domain/refund-rules';
import { transitionPayment } from '../../domain/payment-status';
import type { ServiceContext } from '../../platform/auth/service-auth';
import { enqueueOutboxEvent, refundOutboxPayload } from '../../platform/events/outbox';
import { ProviderCapability } from '../../providers/capabilities';
import { isProviderError } from '../../providers/errors';
import { resolveOrganization } from '../organizations/scope';
import { selectProvider } from '../payments/provider-selection';
import { findPaymentById } from '../payments/repository';
import { toRefundResponse } from './mapper';
import * as repo from './repository';
import type { CreateRefundBody, RefundResponse } from './schema';

export async function createRefund(
  paymentId: string,
  body: CreateRefundBody,
  service: ServiceContext,
  requestId: string,
): Promise<RefundResponse> {
  const payment = await findPaymentById(paymentId);
  if (!payment) {
    throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
  }
  await resolveOrganization(payment.organizationId, service.sourceProduct, 'mutate');

  const selected = await selectProvider({
    organizationId: payment.organizationId,
    paymentAccountId: payment.paymentAccountId,
    requestId,
    requiredCapability: ProviderCapability.REFUNDS,
  });

  return repo.withTransaction(async (tx) => {
    const locked = await repo.lockPaymentRow(paymentId, tx);
    if (!locked) {
      throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
    }

    const refundAmount = body.amount ?? refundableAmount({
      status: locked.status,
      amount: locked.amount,
      refundedAmount: locked.refundedAmount,
    });

    if (refundAmount <= 0) {
      throw new AppError(ErrorCode.REFUND_NOT_ALLOWED, 'No refundable amount remains.');
    }

    const { isPartial, nextStatus } = assertRefundAllowed({
      status: locked.status,
      amount: locked.amount,
      refundedAmount: locked.refundedAmount,
      refundAmount,
      supportsPartialRefunds: selected.provider.capabilities.has(
        ProviderCapability.PARTIAL_REFUNDS,
      ),
    });

    if (!selected.provider.refundPayment) {
      throw new AppError(
        ErrorCode.CAPABILITY_NOT_SUPPORTED,
        'Provider does not support refunds.',
      );
    }

    if (!locked.providerPaymentId) {
      throw new AppError(
        ErrorCode.REFUND_NOT_ALLOWED,
        'Payment has no provider payment id to refund.',
      );
    }

    const refund = await repo.createRefundRow(
      {
        payment: { connect: { id: locked.id } },
        organizationId: locked.organizationId,
        amount: refundAmount,
        currency: locked.currency,
        isPartial,
        status: 'PENDING',
        provider: selected.provider.key,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        ...(body.externalReference !== undefined
          ? { externalReference: body.externalReference }
          : {}),
      },
      tx,
    );

    let providerResult;
    try {
      providerResult = await selected.provider.refundPayment(
        {
          refundId: refund.id,
          providerPaymentId: locked.providerPaymentId,
          amount: { amount: refundAmount, currency: locked.currency },
          isFullRefund: !isPartial,
          idempotencyKey: `refund:${refund.id}`,
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
        },
        selected.context,
      );
    } catch (error) {
      if (isProviderError(error) && error.code === 'REFUND_NOT_ALLOWED') {
        throw new AppError(ErrorCode.REFUND_NOT_ALLOWED, error.message);
      }
      throw error;
    }

    if (providerResult.status !== 'SUCCEEDED') {
      await repo.updateRefundRow(
        refund.id,
        {
          status: providerResult.status === 'FAILED' ? 'FAILED' : 'PROCESSING',
          providerRefundId: providerResult.providerRefundId,
          ...(providerResult.failure?.code !== undefined
            ? { failureCode: providerResult.failure.code }
            : {}),
          ...(providerResult.failure?.message !== undefined
            ? { failureMessage: providerResult.failure.message }
            : {}),
        },
        tx,
      );
      const updated = await repo.updateRefundRow(refund.id, {}, tx);
      return toRefundResponse(updated, {
        status: locked.status,
        amount: locked.amount,
        refundedAmount: locked.refundedAmount,
      });
    }

    transitionPayment(locked.status as never, nextStatus);
    const nextRefunded = locked.refundedAmount + refundAmount;

    await tx.payment.update({
      where: { id: locked.id },
      data: {
        refundedAmount: nextRefunded,
        status: nextStatus,
      },
    });

    const completed = await repo.updateRefundRow(
      refund.id,
      {
        status: 'SUCCEEDED',
        providerRefundId: providerResult.providerRefundId,
        completedAt: new Date(),
      },
      tx,
    );

    await enqueueOutboxEvent(tx, {
      eventType: nextStatus === 'REFUNDED' ? 'payment.refunded' : 'payment.partially_refunded',
      organizationId: locked.organizationId,
      sourceProduct: locked.sourceProduct,
      resourceType: 'refund',
      resourceId: completed.id,
      payload: refundOutboxPayload({
        eventType: nextStatus === 'REFUNDED' ? 'payment.refunded' : 'payment.partially_refunded',
        refundId: completed.id,
        paymentId: locked.id,
        organizationId: locked.organizationId,
        status: nextStatus,
        amount: refundAmount,
        currency: locked.currency,
        isPartial,
      }),
    });

    return toRefundResponse(completed, {
      status: nextStatus,
      amount: locked.amount,
      refundedAmount: nextRefunded,
    });
  });
}

export async function listRefunds(
  paymentId: string,
  service: ServiceContext,
): Promise<{ data: Omit<RefundResponse, 'payment'>[] }> {
  const payment = await findPaymentById(paymentId);
  if (!payment) {
    throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
  }
  await resolveOrganization(payment.organizationId, service.sourceProduct, 'read');
  const rows = await repo.listRefundsForPayment(paymentId);
  return {
    data: rows.map((refund) => {
      const full = toRefundResponse(refund, {
        status: payment.status,
        amount: payment.amount,
        refundedAmount: payment.refundedAmount,
      });
      const { payment: _payment, ...rest } = full;
      return rest;
    }),
  };
}
