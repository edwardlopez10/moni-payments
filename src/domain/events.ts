import { z } from 'zod';

/** Internal event type names delivered to product backends. */
export const EventType = {
  PAYMENT_CREATED: 'payment.created',
  PAYMENT_PROCESSING: 'payment.processing',
  PAYMENT_AUTHORIZED: 'payment.authorized',
  PAYMENT_PAID: 'payment.paid',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_CANCELLED: 'payment.cancelled',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_PARTIALLY_REFUNDED: 'payment.partially_refunded',
  PAYMENT_CHARGEBACK: 'payment.chargeback',
  REFUND_SUCCEEDED: 'refund.succeeded',
  REFUND_FAILED: 'refund.failed',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const EVENT_SCHEMA_VERSION = 1 as const;

const moneyFields = {
  amount: z.number().int(),
  currency: z.string().length(3),
};

export const paymentEventPayloadSchema = z.object({
  version: z.literal(EVENT_SCHEMA_VERSION),
  eventType: z.string(),
  paymentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  status: z.string(),
  ...moneyFields,
  externalReference: z.string(),
  provider: z.string().optional(),
  providerPaymentId: z.string().nullable().optional(),
});

export const refundEventPayloadSchema = z.object({
  version: z.literal(EVENT_SCHEMA_VERSION),
  eventType: z.string(),
  refundId: z.string().uuid(),
  paymentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  status: z.string(),
  ...moneyFields,
  isPartial: z.boolean().optional(),
});

export type PaymentEventPayload = z.infer<typeof paymentEventPayloadSchema>;
export type RefundEventPayload = z.infer<typeof refundEventPayloadSchema>;

export function buildPaymentEventPayload(input: {
  eventType: EventType | string;
  paymentId: string;
  organizationId: string;
  status: string;
  amount: number;
  currency: string;
  externalReference: string;
  provider?: string;
  providerPaymentId?: string | null;
}): PaymentEventPayload {
  return paymentEventPayloadSchema.parse({
    version: EVENT_SCHEMA_VERSION,
    eventType: input.eventType,
    paymentId: input.paymentId,
    organizationId: input.organizationId,
    status: input.status,
    amount: input.amount,
    currency: input.currency,
    externalReference: input.externalReference,
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.providerPaymentId !== undefined
      ? { providerPaymentId: input.providerPaymentId }
      : {}),
  });
}

export function buildRefundEventPayload(input: {
  eventType: EventType | string;
  refundId: string;
  paymentId: string;
  organizationId: string;
  status: string;
  amount: number;
  currency: string;
  isPartial?: boolean;
}): RefundEventPayload {
  return refundEventPayloadSchema.parse({
    version: EVENT_SCHEMA_VERSION,
    eventType: input.eventType,
    refundId: input.refundId,
    paymentId: input.paymentId,
    organizationId: input.organizationId,
    status: input.status,
    amount: input.amount,
    currency: input.currency,
    ...(input.isPartial !== undefined ? { isPartial: input.isPartial } : {}),
  });
}

/** Backoff schedule (ms) after failed delivery attempts 1..7. Attempt 8 → DEAD. */
export const DELIVERY_BACKOFF_MS = [
  2_000,
  8_000,
  30_000,
  120_000,
  600_000,
  1_800_000,
  7_200_000,
] as const;

export const MAX_DELIVERY_ATTEMPTS = 8;

export function nextAttemptDelayMs(attemptNumber: number): number | null {
  // attemptNumber is the count after incrementing (1-based).
  if (attemptNumber >= MAX_DELIVERY_ATTEMPTS) {
    return null;
  }
  return DELIVERY_BACKOFF_MS[attemptNumber - 1] ?? DELIVERY_BACKOFF_MS[DELIVERY_BACKOFF_MS.length - 1]!;
}
