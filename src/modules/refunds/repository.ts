import type { Prisma, Refund } from '@prisma/client';

import { prisma } from '../../db/prisma';
import type { TransactionClient } from '../../db/transaction';
import { withTransaction } from '../../db/transaction';

type Db = Prisma.TransactionClient | typeof prisma;

function db(client?: TransactionClient): Db {
  return client ?? prisma;
}

export async function createRefundRow(
  data: Prisma.RefundCreateInput,
  client?: TransactionClient,
): Promise<Refund> {
  return db(client).refund.create({ data });
}

export async function updateRefundRow(
  id: string,
  data: Prisma.RefundUpdateInput,
  client?: TransactionClient,
): Promise<Refund> {
  return db(client).refund.update({ where: { id }, data });
}

export async function listRefundsForPayment(paymentId: string): Promise<Refund[]> {
  return prisma.refund.findMany({
    where: { paymentId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function lockPaymentRow(paymentId: string, tx: TransactionClient) {
  await tx.$executeRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
  return tx.payment.findUnique({ where: { id: paymentId } });
}

export { withTransaction };
