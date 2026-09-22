import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from './prisma';

export type TransactionClient = Prisma.TransactionClient;

export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  client: PrismaClient = prisma,
): Promise<T> {
  return client.$transaction(async (tx) => fn(tx));
}
