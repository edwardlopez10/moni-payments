import type { Prisma } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import type { ServiceContext } from '../../platform/auth/service-auth';
import { ProviderCapability } from '../../providers/capabilities';
import { resolveOrganization } from '../organizations/scope';
import { selectProvider } from '../payments/provider-selection';
import { toPaymentMethodResponse } from './mapper';
import * as repo from './repository';
import type { CreatePaymentMethodBody, PaymentMethodResponse } from './schema';

export async function listPaymentMethods(
  organizationId: string,
  customerReference: string,
  service: ServiceContext,
): Promise<{ data: PaymentMethodResponse[]; nextCursor: null }> {
  await resolveOrganization(organizationId, service.sourceProduct, 'read');
  const rows = await repo.listPaymentMethods({ organizationId, customerReference });
  return { data: rows.map(toPaymentMethodResponse), nextCursor: null };
}

export async function createPaymentMethod(
  organizationId: string,
  customerReference: string,
  body: CreatePaymentMethodBody,
  service: ServiceContext,
  requestId: string,
): Promise<PaymentMethodResponse> {
  await resolveOrganization(organizationId, service.sourceProduct, 'mutate');

  const selected = await selectProvider({
    organizationId,
    requestId,
    requiredCapability: ProviderCapability.TOKENIZATION,
  });

  if (!selected.provider.createPaymentMethod) {
    throw new AppError(
      ErrorCode.CAPABILITY_NOT_SUPPORTED,
      'Provider does not support tokenization.',
    );
  }

  const result = await selected.provider.createPaymentMethod(
    {
      organizationId,
      customerReference,
      setupToken: body.setupToken,
      metadata: {},
    },
    selected.context,
  );

  const row = await repo.withTransaction(async (tx) => {
    if (body.setDefault) {
      await repo.clearDefaultMethods(organizationId, customerReference, undefined, tx);
    }
    return repo.createPaymentMethodRow(
      {
        organization: { connect: { id: organizationId } },
        customerReference,
        provider: selected.provider.key,
        providerPaymentMethodId: result.providerPaymentMethodId,
        type: result.type,
        isDefault: body.setDefault,
        metadata: result.providerMetadata as Prisma.InputJsonValue,
        ...(result.brand !== undefined ? { brand: result.brand } : {}),
        ...(result.last4 !== undefined ? { last4: result.last4 } : {}),
        ...(result.expirationMonth !== undefined
          ? { expirationMonth: result.expirationMonth }
          : {}),
        ...(result.expirationYear !== undefined
          ? { expirationYear: result.expirationYear }
          : {}),
        ...(result.holderName !== undefined ? { holderName: result.holderName } : {}),
      },
      tx,
    );
  });

  return toPaymentMethodResponse(row);
}

export async function revokePaymentMethod(
  organizationId: string,
  customerReference: string,
  methodId: string,
  service: ServiceContext,
): Promise<PaymentMethodResponse> {
  await resolveOrganization(organizationId, service.sourceProduct, 'mutate');
  const existing = await repo.findPaymentMethodById(methodId);
  if (
    !existing ||
    existing.organizationId !== organizationId ||
    existing.customerReference !== customerReference
  ) {
    throw new AppError(ErrorCode.PAYMENT_METHOD_NOT_FOUND, 'Payment method not found.');
  }
  const row = await repo.revokePaymentMethodRow(methodId);
  return toPaymentMethodResponse(row);
}
