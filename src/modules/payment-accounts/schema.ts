import { z } from 'zod';

import { getProviderRegistry } from '../../providers/registry';

function liveProviderKeySchema() {
  return z.string().min(1).superRefine((key, ctx) => {
    if (!getProviderRegistry().has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Provider '${key}' is not registered.`,
      });
    }
  });
}

export const createPaymentAccountBodySchema = z
  .object({
    provider: liveProviderKeySchema(),
    providerMerchantId: z.string().min(1).max(255),
    isDefault: z.boolean().default(false),
    configuration: z.record(z.string(), z.unknown()).default({}),
    credentialRefs: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const patchPaymentAccountBodySchema = z
  .object({
    status: z.enum(['PENDING_CONFIGURATION', 'ACTIVE', 'DISABLED']).optional(),
    isDefault: z.boolean().optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
    credentialRefs: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const paymentAccountResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  provider: z.string(),
  providerMerchantId: z.string(),
  status: z.enum(['PENDING_CONFIGURATION', 'ACTIVE', 'DISABLED']),
  isDefault: z.boolean(),
  configuration: z.record(z.string(), z.unknown()),
  credentialKeys: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const paymentAccountListResponseSchema = z.object({
  data: z.array(paymentAccountResponseSchema),
});

export type CreatePaymentAccountBody = z.infer<typeof createPaymentAccountBodySchema>;
export type PatchPaymentAccountBody = z.infer<typeof patchPaymentAccountBodySchema>;
export type PaymentAccountResponse = z.infer<typeof paymentAccountResponseSchema>;
