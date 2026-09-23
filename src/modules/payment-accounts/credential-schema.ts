import { z } from 'zod';

import { AppError, ErrorCode } from '../../domain/errors';

/** Fake-provider credential bundle. Other providers reuse this shape until they ship their own. */
const fakeCredentialSchema = z
  .object({
    apiKey: z.string().min(1),
    webhookSecret: z.string().min(1),
  })
  .strict();

export function assertProviderCredentials(
  _provider: string,
  credentials: Record<string, string>,
): void {
  const parsed = fakeCredentialSchema.safeParse(credentials);
  if (parsed.success) {
    return;
  }
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'Credentials do not match the provider schema.', {
    details: parsed.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? `credentials.${issue.path.join('.')}` : 'credentials',
      issue: issue.message,
    })),
  });
}
