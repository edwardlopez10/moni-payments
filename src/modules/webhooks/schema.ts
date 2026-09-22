import { z } from 'zod';

export const webhookAcceptedResponseSchema = z.object({
  received: z.literal(true),
  eventId: z.string().uuid(),
  duplicate: z.boolean(),
});

export type WebhookAcceptedResponse = z.infer<typeof webhookAcceptedResponseSchema>;
