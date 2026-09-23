import type { PaymentAccount, Prisma } from '@prisma/client';

import { prisma } from '../../db/prisma';
import type { TransactionClient } from '../../db/transaction';
import { withTransaction } from '../../db/transaction';

type Db = Prisma.TransactionClient | typeof prisma;

function db(client?: TransactionClient): Db {
  return client ?? prisma;
}

export async function createPaymentAccountRow(
  data: {
    organizationId: string;
    provider: string;
    providerMerchantId: string;
    status: PaymentAccount['status'];
    isDefault: boolean;
    configuration: Prisma.InputJsonValue;
    credentialRefs: Prisma.InputJsonValue;
    secretRef?: string | null;
    credentialsUpdatedAt?: Date | null;
    credentialsPresentKeys?: Prisma.InputJsonValue;
  },
  client?: TransactionClient,
): Promise<PaymentAccount> {
  return db(client).paymentAccount.create({ data });
}

export async function findPaymentAccountById(
  id: string,
  client?: TransactionClient,
): Promise<PaymentAccount | null> {
  return db(client).paymentAccount.findUnique({ where: { id } });
}

export async function listPaymentAccounts(
  organizationId: string,
): Promise<PaymentAccount[]> {
  return prisma.paymentAccount.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}

export async function findDefaultActiveAccount(
  organizationId: string,
  client?: TransactionClient,
): Promise<PaymentAccount | null> {
  return db(client).paymentAccount.findFirst({
    where: { organizationId, isDefault: true, status: 'ACTIVE' },
  });
}

export async function clearDefaultFlags(
  organizationId: string,
  exceptId?: string,
  client?: TransactionClient,
): Promise<void> {
  await db(client).paymentAccount.updateMany({
    where: {
      organizationId,
      isDefault: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { isDefault: false },
  });
}

export async function updatePaymentAccountRow(
  id: string,
  data: Prisma.PaymentAccountUpdateInput,
  client?: TransactionClient,
): Promise<PaymentAccount> {
  return db(client).paymentAccount.update({ where: { id }, data });
}

export { withTransaction };
