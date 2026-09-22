import type { PaymentMethod, Prisma } from '@prisma/client';

import { prisma } from '../../db/prisma';
import type { TransactionClient } from '../../db/transaction';
import { withTransaction } from '../../db/transaction';

type Db = Prisma.TransactionClient | typeof prisma;

function db(client?: TransactionClient): Db {
  return client ?? prisma;
}

export async function listPaymentMethods(input: {
  organizationId: string;
  customerReference: string;
}): Promise<PaymentMethod[]> {
  return prisma.paymentMethod.findMany({
    where: {
      organizationId: input.organizationId,
      customerReference: input.customerReference,
      status: { not: 'REVOKED' },
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function findPaymentMethodById(
  id: string,
  client?: TransactionClient,
): Promise<PaymentMethod | null> {
  return db(client).paymentMethod.findUnique({ where: { id } });
}

export async function createPaymentMethodRow(
  data: Prisma.PaymentMethodCreateInput,
  client?: TransactionClient,
): Promise<PaymentMethod> {
  return db(client).paymentMethod.create({ data });
}

export async function clearDefaultMethods(
  organizationId: string,
  customerReference: string,
  exceptId?: string,
  client?: TransactionClient,
): Promise<void> {
  await db(client).paymentMethod.updateMany({
    where: {
      organizationId,
      customerReference,
      isDefault: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { isDefault: false },
  });
}

export async function revokePaymentMethodRow(
  id: string,
  client?: TransactionClient,
): Promise<PaymentMethod> {
  return db(client).paymentMethod.update({
    where: { id },
    data: { status: 'REVOKED', revokedAt: new Date(), isDefault: false },
  });
}

export { withTransaction };
