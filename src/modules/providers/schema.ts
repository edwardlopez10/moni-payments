import { z } from 'zod';

export const providerDescriptorSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  capabilities: z.array(z.string()),
  supportedCurrencies: z.array(z.string()),
  available: z.boolean(),
});

export const providerListResponseSchema = z.object({
  data: z.array(providerDescriptorSchema),
});

export type ProviderDescriptorResponse = z.infer<typeof providerDescriptorSchema>;
