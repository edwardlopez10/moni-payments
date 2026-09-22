import { randomUUID } from 'node:crypto';

import type { Prisma, SourceProduct } from '@prisma/client';

import {
  buildPaymentEventPayload,
  buildRefundEventPayload,
  type EventType,
} from '../../domain/events';
import type { TransactionClient } from '../../db/transaction';

export interface EnqueueOutboxInput {
  eventType: EventType | string;
  organizationId: string;
  sourceProduct: SourceProduct;
  resourceType: string;
  resourceId: string;
  payload: Prisma.InputJsonValue;
  subscriptionId?: string;
  /** Stable id; generated when omitted. */
  eventId?: string;
}

export async function enqueueOutboxEvent(
  tx: TransactionClient,
  input: EnqueueOutboxInput,
): Promise<{ eventId: string }> {
  const eventId = input.eventId ?? randomUUID();
  await tx.outboxEvent.create({
    data: {
      eventType: input.eventType,
      eventId,
      organizationId: input.organizationId,
      sourceProduct: input.sourceProduct,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.payload,
      ...(input.subscriptionId !== undefined ? { subscriptionId: input.subscriptionId } : {}),
    },
  });
  return { eventId };
}

export function paymentOutboxPayload(input: {
  eventType: EventType | string;
  paymentId: string;
  organizationId: string;
  status: string;
  amount: number;
  currency: string;
  externalReference: string;
  provider?: string;
  providerPaymentId?: string | null;
}): Prisma.InputJsonValue {
  return buildPaymentEventPayload(input) as Prisma.InputJsonValue;
}

export function refundOutboxPayload(input: {
  eventType: EventType | string;
  refundId: string;
  paymentId: string;
  organizationId: string;
  status: string;
  amount: number;
  currency: string;
  isPartial?: boolean;
}): Prisma.InputJsonValue {
  return buildRefundEventPayload(input) as Prisma.InputJsonValue;
}
