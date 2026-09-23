import type { PaymentAccount, Prisma } from '@prisma/client';

import { iso } from '../../platform/http/schemas';
import type { PaymentAccountResponse } from './schema';

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

const DEFAULT_CREDENTIALS_MAX_AGE_DAYS = 90;

export function credentialsAreStale(updatedAt: Date | null, now = Date.now()): boolean {
  if (!updatedAt) {
    return false;
  }
  const configured = Number(process.env.CREDENTIALS_MAX_AGE_DAYS ?? DEFAULT_CREDENTIALS_MAX_AGE_DAYS);
  const maxAgeDays =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CREDENTIALS_MAX_AGE_DAYS;
  return now - updatedAt.getTime() > maxAgeDays * 24 * 60 * 60 * 1000;
}

function credentialKeys(row: PaymentAccount): string[] {
  if (Array.isArray(row.credentialsPresentKeys) && row.credentialsPresentKeys.length > 0) {
    return row.credentialsPresentKeys.filter((key): key is string => typeof key === 'string').sort();
  }
  return Object.keys(asObject(row.credentialRefs)).sort();
}

export function toPaymentAccountResponse(row: PaymentAccount): PaymentAccountResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    providerMerchantId: row.providerMerchantId,
    status: row.status,
    isDefault: row.isDefault,
    configuration: asObject(row.configuration),
    credentialKeys: credentialKeys(row),
    credentialsUpdatedAt: iso(row.credentialsUpdatedAt),
    credentialsStale: credentialsAreStale(row.credentialsUpdatedAt),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}
