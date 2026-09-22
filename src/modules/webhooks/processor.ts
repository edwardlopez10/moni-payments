import type { Payment, PaymentAttempt } from '@prisma/client';

import { EventType } from '../../domain/events';
import {
  canTransition,
  PaymentStatus,
  transitionPayment,
} from '../../domain/payment-status';
import { nextAttemptDelayMs } from '../../domain/events';
import { paymentOutboxPayload, enqueueOutboxEvent } from '../../platform/events/outbox';
import type { NormalizedWebhookEvent } from '../../providers/types';
import * as repo from './repository';

function mapWebhookStatusToDomain(
  status: string,
): PaymentStatus | null {
  switch (status) {
    case 'PENDING':
      return PaymentStatus.PENDING;
    case 'PROCESSING':
      return PaymentStatus.PROCESSING;
    case 'AUTHORIZED':
      return PaymentStatus.AUTHORIZED;
    case 'PAID':
      return PaymentStatus.PAID;
    case 'FAILED':
      return PaymentStatus.FAILED;
    case 'CANCELLED':
      return PaymentStatus.CANCELLED;
    case 'CHARGEBACK':
      return PaymentStatus.CHARGEBACK;
    default:
      return null;
  }
}

function eventTypeForStatus(status: PaymentStatus): string {
  switch (status) {
    case PaymentStatus.PROCESSING:
      return EventType.PAYMENT_PROCESSING;
    case PaymentStatus.AUTHORIZED:
      return EventType.PAYMENT_AUTHORIZED;
    case PaymentStatus.PAID:
      return EventType.PAYMENT_PAID;
    case PaymentStatus.FAILED:
      return EventType.PAYMENT_FAILED;
    case PaymentStatus.CANCELLED:
      return EventType.PAYMENT_CANCELLED;
    case PaymentStatus.CHARGEBACK:
      return EventType.PAYMENT_CHARGEBACK;
    case PaymentStatus.REFUNDED:
      return EventType.PAYMENT_REFUNDED;
    case PaymentStatus.PARTIALLY_REFUNDED:
      return EventType.PAYMENT_PARTIALLY_REFUNDED;
    default:
      return EventType.PAYMENT_PROCESSING;
  }
}

async function applyPaymentWebhook(
  event: Extract<NormalizedWebhookEvent, { kind: 'PAYMENT' }>,
  webhookId: string,
  providerKey: string,
): Promise<void> {
  const payment = await repo.findPaymentByProviderIds(providerKey, event.providerPaymentId);
  if (!payment) {
    await repo.updateWebhookEvent(webhookId, {
      processingStatus: 'IGNORED',
      processedAt: new Date(),
      error: 'unknown providerPaymentId',
    });
    return;
  }

  const target = mapWebhookStatusToDomain(event.status);
  if (!target) {
    await repo.updateWebhookEvent(webhookId, {
      processingStatus: 'IGNORED',
      processedAt: new Date(),
      error: `unrecognised status ${event.status}`,
      paymentId: payment.id,
    });
    return;
  }

  if (!canTransition(payment.status as PaymentStatus, target)) {
    await repo.updateWebhookEvent(webhookId, {
      processingStatus: 'IGNORED',
      processedAt: new Date(),
      error: `stale transition ${payment.status} -> ${target}`,
      paymentId: payment.id,
    });
    return;
  }

  const update = transitionPayment(payment.status as PaymentStatus, target);

  await repo.withTransaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: update.status,
        ...(update.authorizedAt ? { authorizedAt: update.authorizedAt } : {}),
        ...(update.paidAt ? { paidAt: update.paidAt } : {}),
        ...(update.failedAt ? { failedAt: update.failedAt } : {}),
        ...(update.cancelledAt ? { cancelledAt: update.cancelledAt } : {}),
        ...(event.failure
          ? { failureCode: event.failure.code, failureMessage: event.failure.message }
          : {}),
      },
    });

    const latestAttempt = (payment.attempts as PaymentAttempt[]).at(-1);
    if (latestAttempt) {
      await tx.paymentAttempt.update({
        where: { id: latestAttempt.id },
        data: {
          status:
            target === PaymentStatus.FAILED
              ? 'FAILED'
              : target === PaymentStatus.PAID || target === PaymentStatus.AUTHORIZED
                ? 'SUCCEEDED'
                : 'PROCESSING',
          completedAt:
            target === PaymentStatus.FAILED ||
            target === PaymentStatus.PAID ||
            target === PaymentStatus.AUTHORIZED
              ? new Date()
              : null,
        },
      });
    }

    await enqueueOutboxEvent(tx, {
      eventType: eventTypeForStatus(target),
      organizationId: payment.organizationId,
      sourceProduct: payment.sourceProduct,
      resourceType: 'payment',
      resourceId: payment.id,
      payload: paymentOutboxPayload({
        eventType: eventTypeForStatus(target),
        paymentId: payment.id,
        organizationId: payment.organizationId,
        status: target,
        amount: payment.amount,
        currency: payment.currency,
        externalReference: payment.externalReference,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
      }),
    });

    await tx.webhookEvent.update({
      where: { id: webhookId },
      data: {
        processingStatus: 'PROCESSED',
        processedAt: new Date(),
        paymentId: payment.id,
        error: null,
      },
    });
  });
}

async function applyRefundWebhook(
  event: Extract<NormalizedWebhookEvent, { kind: 'REFUND' }>,
  webhookId: string,
  providerKey: string,
): Promise<void> {
  const refund = await repo.findRefundByProviderIds(providerKey, event.providerRefundId);
  if (!refund) {
    await repo.updateWebhookEvent(webhookId, {
      processingStatus: 'IGNORED',
      processedAt: new Date(),
      error: 'unknown providerRefundId',
    });
    return;
  }

  await repo.withTransaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: event.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
        completedAt: new Date(),
        ...(event.failure
          ? { failureCode: event.failure.code, failureMessage: event.failure.message }
          : {}),
      },
    });
    await tx.webhookEvent.update({
      where: { id: webhookId },
      data: {
        processingStatus: 'PROCESSED',
        processedAt: new Date(),
        paymentId: refund.paymentId,
      },
    });
  });
}

export async function processWebhookEvent(webhookId: string): Promise<void> {
  const claimed = await repo.claimWebhookEvent(webhookId);
  if (!claimed) {
    return;
  }

  try {
    const parsed = claimed.payload as unknown as NormalizedWebhookEvent;
    if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) {
      await repo.updateWebhookEvent(webhookId, {
        processingStatus: 'IGNORED',
        processedAt: new Date(),
        error: 'unrecognised payload shape',
      });
      return;
    }

    if (parsed.kind === 'UNKNOWN') {
      await repo.updateWebhookEvent(webhookId, {
        processingStatus: 'IGNORED',
        processedAt: new Date(),
        error: 'unknown event kind',
      });
      return;
    }

    if (parsed.kind === 'PAYMENT') {
      await applyPaymentWebhook(parsed, webhookId, claimed.provider);
      return;
    }

    if (parsed.kind === 'REFUND') {
      await applyRefundWebhook(parsed, webhookId, claimed.provider);
      return;
    }

    await repo.updateWebhookEvent(webhookId, {
      processingStatus: 'IGNORED',
      processedAt: new Date(),
    });
  } catch (error) {
    const delay = nextAttemptDelayMs(claimed.attempts);
    await repo.updateWebhookEvent(webhookId, {
      processingStatus: 'FAILED',
      error: error instanceof Error ? error.message : 'processing failed',
      nextRetryAt: delay === null ? null : new Date(Date.now() + delay),
    });
    if (delay === null) {
      // Budget exhausted — leave FAILED with no nextRetryAt so dispatcher skips it.
    }
  }
}

export type { Payment };
