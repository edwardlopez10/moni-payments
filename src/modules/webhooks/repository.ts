import type { Prisma, WebhookEvent, WebhookProcessingStatus } from '@prisma/client';

import { prisma } from '../../db/prisma';
import type { TransactionClient } from '../../db/transaction';
import { withTransaction } from '../../db/transaction';

type Db = Prisma.TransactionClient | typeof prisma;

function db(client?: TransactionClient): Db {
  return client ?? prisma;
}

export async function insertWebhookEvent(
  data: {
    provider: string;
    providerEventId: string;
    eventType: string | null;
    payload: Prisma.InputJsonValue;
    rawBody: string;
    headers: Prisma.InputJsonValue;
    signature: string | null;
    verified: boolean;
  },
  client?: TransactionClient,
): Promise<WebhookEvent> {
  return db(client).webhookEvent.create({
    data: {
      provider: data.provider,
      providerEventId: data.providerEventId,
      eventType: data.eventType,
      payload: data.payload,
      rawBody: data.rawBody,
      headers: data.headers,
      signature: data.signature,
      verified: data.verified,
      processingStatus: 'RECEIVED',
    },
  });
}

export async function findWebhookByProviderEvent(
  provider: string,
  providerEventId: string,
): Promise<WebhookEvent | null> {
  return prisma.webhookEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId } },
  });
}

export async function findWebhookById(
  id: string,
  client?: TransactionClient,
): Promise<WebhookEvent | null> {
  return db(client).webhookEvent.findUnique({ where: { id } });
}

export async function updateWebhookEvent(
  id: string,
  data: Prisma.WebhookEventUpdateInput,
  client?: TransactionClient,
): Promise<WebhookEvent> {
  return db(client).webhookEvent.update({ where: { id }, data });
}

/** Atomically claim a due webhook for processing. Returns null if already claimed. */
export async function claimWebhookEvent(id: string): Promise<WebhookEvent | null> {
  const result = await prisma.$executeRaw`
    UPDATE webhook_events
    SET processing_status = 'PROCESSING',
        attempts = attempts + 1
    WHERE id = ${id}
      AND (
        processing_status = 'RECEIVED'
        OR (
          processing_status = 'FAILED'
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        )
      )
  `;
  if (result === 0) {
    return null;
  }
  return prisma.webhookEvent.findUnique({ where: { id } });
}

export async function listDueWebhookEvents(limit: number): Promise<WebhookEvent[]> {
  return prisma.webhookEvent.findMany({
    where: {
      OR: [
        { processingStatus: 'RECEIVED' },
        {
          processingStatus: 'FAILED',
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
        },
      ],
    },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  });
}

export async function findPaymentByProviderIds(
  provider: string,
  providerPaymentId: string,
  client?: TransactionClient,
) {
  return db(client).payment.findFirst({
    where: { provider, providerPaymentId },
    include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
  });
}

export async function findRefundByProviderIds(
  provider: string,
  providerRefundId: string,
  client?: TransactionClient,
) {
  return db(client).refund.findFirst({
    where: { provider, providerRefundId },
  });
}

export async function listCandidateAccounts(provider: string) {
  return prisma.paymentAccount.findMany({
    where: { provider, status: { in: ['ACTIVE', 'PENDING_CONFIGURATION'] } },
  });
}

export type { WebhookProcessingStatus };
export { withTransaction, prisma };
