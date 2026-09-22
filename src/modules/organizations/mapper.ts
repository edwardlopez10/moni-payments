import type { Organization, Prisma } from '@prisma/client';

import { iso } from '../../platform/http/schemas';
import type { OrganizationResponse } from './schema';

function asStringRecord(value: Prisma.JsonValue): Record<string, string> {
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

export function toOrganizationResponse(row: Organization): OrganizationResponse {
  return {
    id: row.id,
    sourceProduct: row.sourceProduct,
    externalId: row.externalId,
    name: row.name,
    status: row.status,
    metadata: asStringRecord(row.metadata),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}
