import { z } from 'zod';

import {
  amountSchema,
  metadataSchema,
} from '../../platform/http/schemas';

export const createPaymentBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    externalReference: z.string().min(1).max(255),
    customerReference: z.string().min(1).max(255),
    amount: amountSchema,
    currency: z.string().length(3),
    description: z.string().max(1000).optional(),
    paymentAccountId: z.string().uuid().nullable().optional(),
    paymentMethodId: z.string().uuid().nullable().optional(),
    returnUrl: z.string().url().optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const paymentAttemptSummarySchema = z.object({
  id: z.string().uuid(),
  attemptNumber: z.number().int(),
  status: z.enum(['INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED']),
  failureCode: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const paymentResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  sourceProduct: z.enum(['RESIDENT', 'HEALTH', 'ENVIRONMENT']),
  externalReference: z.string(),
  customerReference: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  refundedAmount: z.number().int(),
  refundableAmount: z.number().int(),
  status: z.string(),
  provider: z.string(),
  providerPaymentId: z.string().nullable(),
  description: z.string().nullable(),
  checkoutUrl: z.string().nullable(),
  metadata: z.record(z.string(), z.string()),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  authorizedAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  latestAttempt: paymentAttemptSummarySchema.nullable().optional(),
  attempts: z.array(paymentAttemptSummarySchema).optional(),
  refunds: z.array(z.unknown()).optional(),
});

export const listPaymentsQuerySchema = z.object({
  organizationId: z.string().uuid(),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  customerReference: z.string().optional(),
  externalReference: z.string().optional(),
  provider: z.string().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const paymentListResponseSchema = z.object({
  data: z.array(paymentResponseSchema),
  nextCursor: z.string().nullable(),
});

export type CreatePaymentBody = z.infer<typeof createPaymentBodySchema>;
export type PaymentResponse = z.infer<typeof paymentResponseSchema>;
