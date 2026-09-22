import type { Organization, Prisma, SourceProduct } from '@prisma/client';

import { prisma } from '../../db/prisma';
import type { TransactionClient } from '../../db/transaction';

type Db = Prisma.TransactionClient | typeof prisma;

function db(client?: TransactionClient): Db {
  return client ?? prisma;
}

export async function createOrganizationRow(
  data: {
    sourceProduct: SourceProduct;
    externalId: string;
    name: string;
    metadata: Prisma.InputJsonValue;
  },
  client?: TransactionClient,
): Promise<Organization> {
  return db(client).organization.create({ data });
}

export async function findOrganizationById(
  id: string,
  client?: TransactionClient,
): Promise<Organization | null> {
  return db(client).organization.findUnique({ where: { id } });
}

export async function findOrganizationByExternalId(
  sourceProduct: SourceProduct,
  externalId: string,
  client?: TransactionClient,
): Promise<Organization | null> {
  return db(client).organization.findUnique({
    where: { sourceProduct_externalId: { sourceProduct, externalId } },
  });
}

export async function listOrganizations(input: {
  sourceProduct: SourceProduct;
  externalId?: string;
  limit: number;
  cursor?: { createdAt: Date; id: string };
}): Promise<Organization[]> {
  const where: Prisma.OrganizationWhereInput = {
    sourceProduct: input.sourceProduct,
  };
  if (input.externalId !== undefined) {
    where.externalId = input.externalId;
  }
  if (input.cursor) {
    where.OR = [
      { createdAt: { lt: input.cursor.createdAt } },
      { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
    ];
  }

  return prisma.organization.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
  });
}
