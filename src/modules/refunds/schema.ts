import { z } from 'zod';

import { amountSchema, metadataSchema } from '../../platform/http/schemas';

export const createRefundBodySchema = z
  .object({
    amount: amountSchema.optional(),
    reason: z.string().max(500).optional(),
    externalReference: z.string().min(1).max(255).optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const refundResponseSchema = z.object({
  id: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().int(),
  currency: z.string(),
  isPartial: z.boolean(),
  status: z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED']),
  provider: z.string(),
  providerRefundId: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  payment: z.object({
    status: z.string(),
    refundedAmount: z.number().int(),
    refundableAmount: z.number().int(),
  }),
});

export const refundListResponseSchema = z.object({
  data: z.array(refundResponseSchema.omit({ payment: true })),
});

export type CreateRefundBody = z.infer<typeof createRefundBodySchema>;
export type RefundResponse = z.infer<typeof refundResponseSchema>;
