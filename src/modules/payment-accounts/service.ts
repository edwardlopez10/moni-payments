import type { PaymentAccountStatus, Prisma } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import type { ServiceContext } from '../../platform/auth/service-auth';
import {
  assertValidSecretReference,
  getSecretsProvider,
} from '../../platform/secrets';
import { resolveOrganization } from '../organizations/scope';
import { toPaymentAccountResponse } from './mapper';
import * as repo from './repository';
import type {
  CreatePaymentAccountBody,
  PatchPaymentAccountBody,
  PaymentAccountResponse,
} from './schema';

async function resolveCredentialStatus(
  refs: Record<string, string>,
): Promise<PaymentAccountStatus> {
  const secrets = getSecretsProvider();
  for (const reference of Object.values(refs)) {
    assertValidSecretReference(reference, secrets);
  }

  for (const reference of Object.values(refs)) {
    try {
      await secrets.resolve(reference);
    } catch {
      return 'PENDING_CONFIGURATION';
    }
  }

  return Object.keys(refs).length === 0 ? 'PENDING_CONFIGURATION' : 'ACTIVE';
}

export async function createPaymentAccount(
  organizationId: string,
  body: CreatePaymentAccountBody,
  service: ServiceContext,
): Promise<PaymentAccountResponse> {
  await resolveOrganization(organizationId, service.sourceProduct, 'mutate');

  for (const reference of Object.values(body.credentialRefs)) {
    assertValidSecretReference(reference);
  }

  const status = await resolveCredentialStatus(body.credentialRefs);

  const row = await repo.withTransaction(async (tx) => {
    if (body.isDefault) {
      await repo.clearDefaultFlags(organizationId, undefined, tx);
    }
    return repo.createPaymentAccountRow(
      {
        organizationId,
        provider: body.provider,
        providerMerchantId: body.providerMerchantId,
        status,
        isDefault: body.isDefault,
        configuration: body.configuration as Prisma.InputJsonValue,
        credentialRefs: body.credentialRefs as Prisma.InputJsonValue,
      },
      tx,
    );
  });

  return toPaymentAccountResponse(row);
}

export async function listPaymentAccounts(
  organizationId: string,
  service: ServiceContext,
): Promise<{ data: PaymentAccountResponse[] }> {
  await resolveOrganization(organizationId, service.sourceProduct, 'read');
  const rows = await repo.listPaymentAccounts(organizationId);
  return { data: rows.map(toPaymentAccountResponse) };
}

export async function patchPaymentAccount(
  organizationId: string,
  accountId: string,
  body: PatchPaymentAccountBody,
  service: ServiceContext,
): Promise<PaymentAccountResponse> {
  await resolveOrganization(organizationId, service.sourceProduct, 'mutate');
  const existing = await repo.findPaymentAccountById(accountId);
  if (!existing || existing.organizationId !== organizationId) {
    throw new AppError(ErrorCode.PROVIDER_CONFIGURATION_ERROR, 'Payment account not found.', {
      details: [{ field: 'accountId', issue: 'not found for organization' }],
    });
  }

  if (body.credentialRefs) {
    for (const reference of Object.values(body.credentialRefs)) {
      assertValidSecretReference(reference);
    }
  }

  const nextRefs = (body.credentialRefs ??
    (existing.credentialRefs as Record<string, string>)) as Record<string, string>;
  let status = body.status;
  if (body.credentialRefs && status === undefined) {
    status = await resolveCredentialStatus(body.credentialRefs);
  }

  const row = await repo.withTransaction(async (tx) => {
    if (body.isDefault === true) {
      await repo.clearDefaultFlags(organizationId, accountId, tx);
    }
    return repo.updatePaymentAccountRow(
      accountId,
      {
        ...(status !== undefined ? { status } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.configuration !== undefined
          ? { configuration: body.configuration as Prisma.InputJsonValue }
          : {}),
        ...(body.credentialRefs !== undefined
          ? { credentialRefs: nextRefs as Prisma.InputJsonValue }
          : {}),
      },
      tx,
    );
  });

  return toPaymentAccountResponse(row);
}
