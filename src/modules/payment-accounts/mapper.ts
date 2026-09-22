import type { PaymentAccount, Prisma } from '@prisma/client';

import { iso } from '../../platform/http/schemas';
import type { PaymentAccountResponse } from './schema';

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function credentialKeys(value: Prisma.JsonValue): string[] {
  return Object.keys(asObject(value)).sort();
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
    credentialKeys: credentialKeys(row.credentialRefs),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}
