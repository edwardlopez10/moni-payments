import type {
  Payment,
  PaymentAttempt,
  PaymentStatus,
  Prisma,
  Refund,
} from '@prisma/client';

import { prisma } from '../../db/prisma';
import type { TransactionClient } from '../../db/transaction';
import { withTransaction } from '../../db/transaction';

type Db = Prisma.TransactionClient | typeof prisma;

function db(client?: TransactionClient): Db {
  return client ?? prisma;
}

export type PaymentWithRelations = Payment & {
  attempts: PaymentAttempt[];
  refunds: Refund[];
};

export async function findPaymentByExternalReference(
  organizationId: string,
  externalReference: string,
  client?: TransactionClient,
): Promise<Payment | null> {
  return db(client).payment.findUnique({
    where: {
      organizationId_externalReference: { organizationId, externalReference },
    },
  });
}

export async function findPaymentById(
  id: string,
  client?: TransactionClient,
): Promise<PaymentWithRelations | null> {
  return db(client).payment.findUnique({
    where: { id },
    include: {
      attempts: { orderBy: { attemptNumber: 'asc' } },
      refunds: { orderBy: { createdAt: 'asc' } },
    },
  });
}

export async function createPaymentWithAttempt(
  data: {
    payment: Prisma.PaymentCreateInput;
    attempt: Omit<Prisma.PaymentAttemptCreateWithoutPaymentInput, 'payment'>;
  },
  client?: TransactionClient,
): Promise<PaymentWithRelations> {
  return db(client).payment.create({
    data: {
      ...data.payment,
      attempts: { create: data.attempt },
    },
    include: {
      attempts: { orderBy: { attemptNumber: 'asc' } },
      refunds: true,
    },
  });
}

export async function updatePaymentRow(
  id: string,
  data: Prisma.PaymentUpdateInput,
  client?: TransactionClient,
): Promise<Payment> {
  return db(client).payment.update({ where: { id }, data });
}

export async function updateAttemptRow(
  id: string,
  data: Prisma.PaymentAttemptUpdateInput,
  client?: TransactionClient,
): Promise<PaymentAttempt> {
  return db(client).paymentAttempt.update({ where: { id }, data });
}

export async function createAttemptRow(
  data: Prisma.PaymentAttemptCreateInput,
  client?: TransactionClient,
): Promise<PaymentAttempt> {
  return db(client).paymentAttempt.create({ data });
}

export async function listPayments(input: {
  organizationId: string;
  statuses?: PaymentStatus[];
  customerReference?: string;
  externalReference?: string;
  provider?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit: number;
  cursor?: { createdAt: Date; id: string };
}): Promise<PaymentWithRelations[]> {
  const where: Prisma.PaymentWhereInput = {
    organizationId: input.organizationId,
  };
  if (input.statuses && input.statuses.length > 0) {
    where.status = { in: input.statuses };
  }
  if (input.customerReference) {
    where.customerReference = input.customerReference;
  }
  if (input.externalReference) {
    where.externalReference = input.externalReference;
  }
  if (input.provider) {
    where.provider = input.provider;
  }
  if (input.createdAfter || input.createdBefore) {
    where.createdAt = {
      ...(input.createdAfter ? { gte: input.createdAfter } : {}),
      ...(input.createdBefore ? { lte: input.createdBefore } : {}),
    };
  }
  if (input.cursor) {
    where.AND = [
      {
        OR: [
          { createdAt: { lt: input.cursor.createdAt } },
          { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
        ],
      },
    ];
  }

  return prisma.payment.findMany({
    where,
    include: {
      attempts: { orderBy: { attemptNumber: 'asc' } },
      refunds: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
  });
}

export async function lockPaymentForUpdate(
  id: string,
  tx: TransactionClient,
): Promise<Payment | null> {
  const rows = await tx.$queryRaw<Payment[]>`
    SELECT * FROM payments WHERE id = ${id}::uuid FOR UPDATE
  `;
  return rows[0] ?? null;
}

export { withTransaction, prisma };
