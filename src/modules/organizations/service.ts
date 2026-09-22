import { Prisma, type SourceProduct } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import type { ServiceContext } from '../../platform/auth/service-auth';
import { decodeCursor, encodeCursor } from '../../platform/http/schemas';
import { toOrganizationResponse } from './mapper';
import * as repo from './repository';
import type { CreateOrganizationBody, OrganizationResponse } from './schema';
import { resolveOrganization } from './scope';

export async function createOrganization(
  body: CreateOrganizationBody,
  service: ServiceContext,
): Promise<OrganizationResponse> {
  try {
    const row = await repo.createOrganizationRow({
      sourceProduct: service.sourceProduct,
      externalId: body.externalId,
      name: body.name,
      metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
    });
    return toOrganizationResponse(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await repo.findOrganizationByExternalId(
        service.sourceProduct,
        body.externalId,
      );
      throw new AppError(
        ErrorCode.DUPLICATE_EXTERNAL_REFERENCE,
        'An organization with this externalId already exists for this product.',
        {
          details: existing
            ? [{ field: 'externalId', issue: `existing organization id ${existing.id}` }]
            : [{ field: 'externalId', issue: 'already exists' }],
        },
      );
    }
    throw error;
  }
}

export async function getOrganization(
  id: string,
  service: ServiceContext,
): Promise<OrganizationResponse> {
  const row = await resolveOrganization(id, service.sourceProduct, 'read');
  return toOrganizationResponse(row);
}

export async function listOrganizations(
  query: { externalId?: string; limit: number; cursor?: string },
  service: ServiceContext,
): Promise<{ data: OrganizationResponse[]; nextCursor: string | null }> {
  let cursor: { createdAt: Date; id: string } | undefined;
  if (query.cursor) {
    try {
      cursor = decodeCursor(query.cursor);
    } catch {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid cursor.', {
        details: [{ field: 'cursor', issue: 'malformed' }],
      });
    }
  }

  const rows = await repo.listOrganizations({
    sourceProduct: service.sourceProduct,
    limit: query.limit,
    ...(query.externalId !== undefined ? { externalId: query.externalId } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map(toOrganizationResponse),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export type { SourceProduct };
