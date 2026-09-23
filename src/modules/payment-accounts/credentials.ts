import type { PaymentAccount, Prisma } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import type { SecretsProvider } from '../../platform/secrets';

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

/**
 * Load provider credentials for an account.
 * New rows store one bundle behind `secretRef`. Older rows still store per-field references.
 */
export async function loadAccountCredentialBundle(
  account: Pick<PaymentAccount, 'secretRef' | 'credentialRefs'>,
  secrets: SecretsProvider,
): Promise<Record<string, string>> {
  if (account.secretRef) {
    const bundle = await secrets.get<unknown>(account.secretRef);
    const values = asStringRecord(bundle);
    if (Object.keys(values).length === 0) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Secret payload is malformed.',
      );
    }
    return values;
  }

  const refs = asStringRecord(account.credentialRefs as Prisma.JsonValue);
  if (refs.bundle && Object.keys(refs).length === 1) {
    return loadAccountCredentialBundle({ secretRef: refs.bundle, credentialRefs: {} }, secrets);
  }

  const credentials: Record<string, string> = {};
  for (const [key, reference] of Object.entries(refs)) {
    const value = await secrets.get<unknown>(reference);
    if (typeof value !== 'string' || value.length === 0) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Secret payload is malformed.',
      );
    }
    credentials[key] = value;
  }
  return credentials;
}
