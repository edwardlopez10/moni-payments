import { z } from 'zod';

export const createPaymentMethodBodySchema = z
  .object({
    setupToken: z.string().min(1),
    setDefault: z.boolean().default(false),
  })
  .strict();

export const paymentMethodResponseSchema = z.object({
  id: z.string().uuid(),
  customerReference: z.string(),
  provider: z.string(),
  type: z.enum(['CARD', 'BANK_ACCOUNT', 'WALLET', 'OTHER']),
  status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expirationMonth: z.number().int().nullable(),
  expirationYear: z.number().int().nullable(),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
});

export const paymentMethodListResponseSchema = z.object({
  data: z.array(paymentMethodResponseSchema),
  nextCursor: z.string().nullable(),
});

export type CreatePaymentMethodBody = z.infer<typeof createPaymentMethodBodySchema>;
export type PaymentMethodResponse = z.infer<typeof paymentMethodResponseSchema>;
