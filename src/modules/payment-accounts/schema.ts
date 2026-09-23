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

export const paymentAccountStatusSchema = z.enum([
  'NOT_CONFIGURED',
  'ONBOARDING',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DISABLED',
  'REJECTED',
]);

/** Accounts that may still present a webhook secret. Terminal accounts are excluded. */
export const webhookCandidateStatuses = [
  'NOT_CONFIGURED',
  'ONBOARDING',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
] as const;

export const createPaymentAccountBodySchema = z
  .object({
    provider: liveProviderKeySchema(),
    providerMerchantId: z.string().min(1).max(255),
    isDefault: z.boolean().default(false),
    configuration: z.record(z.string(), z.unknown()).default({}),
    credentials: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const patchPaymentAccountBodySchema = z
  .object({
    status: paymentAccountStatusSchema.optional(),
    isDefault: z.boolean().optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
    credentials: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const rotatePaymentAccountCredentialsBodySchema = z
  .object({
    credentials: z.record(z.string(), z.string()),
  })
  .strict();

export const paymentAccountResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  provider: z.string(),
  providerMerchantId: z.string(),
  status: paymentAccountStatusSchema,
  isDefault: z.boolean(),
  configuration: z.record(z.string(), z.unknown()),
  credentialKeys: z.array(z.string()),
  credentialsUpdatedAt: z.string().datetime().nullable(),
  credentialsStale: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const paymentAccountListResponseSchema = z.object({
  data: z.array(paymentAccountResponseSchema),
});

export type CreatePaymentAccountBody = z.infer<typeof createPaymentAccountBodySchema>;
export type PatchPaymentAccountBody = z.infer<typeof patchPaymentAccountBodySchema>;
export type RotatePaymentAccountCredentialsBody = z.infer<
  typeof rotatePaymentAccountCredentialsBodySchema
>;
export type PaymentAccountResponse = z.infer<typeof paymentAccountResponseSchema>;
