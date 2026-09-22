import type { Prisma } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import { assertValidMoney } from '../../domain/money';
import {
  PaymentStatus,
  transitionPayment,
} from '../../domain/payment-status';
import type { ServiceContext } from '../../platform/auth/service-auth';
import { enqueueOutboxEvent, paymentOutboxPayload } from '../../platform/events/outbox';
import { decodeCursor, encodeCursor } from '../../platform/http/schemas';
import { isProviderError } from '../../providers/errors';
import { ProviderCapability } from '../../providers/capabilities';
import type { PaymentResult } from '../../providers/types';
import { resolveOrganization } from '../organizations/scope';
import { prisma } from '../../db/prisma';
import { toPaymentResponse } from './mapper';
import { selectProvider } from './provider-selection';
import * as repo from './repository';
import type { CreatePaymentBody, PaymentResponse } from './schema';

function paymentPayload(input: {
  id: string;
  organizationId: string;
  status: string;
  amount: number;
  currency: string;
  externalReference: string;
  eventType: string;
  provider?: string;
  providerPaymentId?: string | null;
}): Prisma.InputJsonValue {
  return paymentOutboxPayload({
    eventType: input.eventType,
    paymentId: input.id,
    organizationId: input.organizationId,
    status: input.status,
    amount: input.amount,
    currency: input.currency,
    externalReference: input.externalReference,
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.providerPaymentId !== undefined
      ? { providerPaymentId: input.providerPaymentId }
      : {}),
  });
}

function mapProviderStatusToDomain(
  status: PaymentResult['status'],
): typeof PaymentStatus.PROCESSING | typeof PaymentStatus.PAID | typeof PaymentStatus.FAILED | typeof PaymentStatus.AUTHORIZED | typeof PaymentStatus.CANCELLED {
  switch (status) {
    case 'PAID':
      return PaymentStatus.PAID;
    case 'FAILED':
      return PaymentStatus.FAILED;
    case 'AUTHORIZED':
      return PaymentStatus.AUTHORIZED;
    case 'CANCELLED':
      return PaymentStatus.CANCELLED;
    case 'PENDING':
    case 'PROCESSING':
    default:
      return PaymentStatus.PROCESSING;
  }
}

export async function createPayment(
  body: CreatePaymentBody,
  service: ServiceContext,
  requestId: string,
): Promise<PaymentResponse> {
  assertValidMoney({ amount: body.amount, currency: body.currency });

  const organization = await resolveOrganization(
    body.organizationId,
    service.sourceProduct,
    'mutate',
  );
  if (organization.status !== 'ACTIVE') {
    throw new AppError(ErrorCode.FORBIDDEN, 'Organization is not active.');
  }

  const requiredCapability = body.paymentMethodId
    ? ProviderCapability.TOKENIZATION
    : undefined;

  const selected = await selectProvider({
    organizationId: organization.id,
    paymentAccountId: body.paymentAccountId,
    requestId,
    requiredCapability,
    currency: body.currency,
  });

  if (body.paymentMethodId) {
    const method = await prisma.paymentMethod.findUnique({
      where: { id: body.paymentMethodId },
    });
    if (
      !method ||
      method.organizationId !== organization.id ||
      method.customerReference !== body.customerReference ||
      method.status !== 'ACTIVE'
    ) {
      throw new AppError(ErrorCode.PAYMENT_METHOD_NOT_FOUND, 'Payment method not found.');
    }
  }

  const duplicate = await repo.findPaymentByExternalReference(
    organization.id,
    body.externalReference,
  );
  if (duplicate) {
    throw new AppError(
      ErrorCode.DUPLICATE_EXTERNAL_REFERENCE,
      'A payment with this externalReference already exists for the organization.',
      {
        details: [{ field: 'externalReference', issue: `existing payment id ${duplicate.id}` }],
      },
    );
  }

  const metadata = body.metadata ?? {};

  let payment = await repo.createPaymentWithAttempt({
    payment: {
      organization: { connect: { id: organization.id } },
      paymentAccount: { connect: { id: selected.account.id } },
      sourceProduct: service.sourceProduct,
      externalReference: body.externalReference,
      customerReference: body.customerReference,
      amount: body.amount,
      currency: body.currency,
      status: PaymentStatus.PENDING,
      provider: selected.provider.key,
      metadata: metadata as Prisma.InputJsonValue,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.paymentMethodId
        ? { paymentMethod: { connect: { id: body.paymentMethodId } } }
        : {}),
    },
    attempt: {
      attemptNumber: 1,
      provider: selected.provider.key,
      status: 'INITIATED',
    },
  });

  await repo.withTransaction(async (tx) => {
    await enqueueOutboxEvent(tx, {
      eventType: 'payment.created',
      organizationId: organization.id,
      sourceProduct: service.sourceProduct,
      resourceType: 'payment',
      resourceId: payment.id,
      payload: paymentPayload({
        id: payment.id,
        organizationId: organization.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        externalReference: payment.externalReference,
        eventType: 'payment.created',
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
      }),
    });
  });

  const attempt = payment.attempts[0]!;
  let providerResult: PaymentResult;

  try {
    if (body.paymentMethodId) {
      const method = await prisma.paymentMethod.findUniqueOrThrow({
        where: { id: body.paymentMethodId },
      });
      if (!selected.provider.chargePaymentMethod) {
        throw new AppError(
          ErrorCode.CAPABILITY_NOT_SUPPORTED,
          'Provider does not support tokenization charges.',
        );
      }
      providerResult = await selected.provider.chargePaymentMethod(
        {
          paymentId: payment.id,
          amount: { amount: body.amount, currency: body.currency },
          customerReference: body.customerReference,
          providerPaymentMethodId: method.providerPaymentMethodId,
          idempotencyKey: `${payment.id}:1`,
          metadata,
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.returnUrl !== undefined ? { returnUrl: body.returnUrl } : {}),
        },
        selected.context,
      );
    } else {
      providerResult = await selected.provider.createPayment(
        {
          paymentId: payment.id,
          amount: { amount: body.amount, currency: body.currency },
          customerReference: body.customerReference,
          idempotencyKey: `${payment.id}:1`,
          metadata,
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.returnUrl !== undefined ? { returnUrl: body.returnUrl } : {}),
        },
        selected.context,
      );
    }
  } catch (error) {
    if (isProviderError(error) && error.code === 'PROVIDER_UNAVAILABLE') {
      throw new AppError(ErrorCode.PROVIDER_UNAVAILABLE, error.message);
    }
    throw error;
  }

  const domainStatus = mapProviderStatusToDomain(providerResult.status);
  const transition = transitionPayment(PaymentStatus.PENDING, domainStatus);

  payment = await repo.withTransaction(async (tx) => {
    await repo.updateAttemptRow(
      attempt.id,
      {
        status:
          domainStatus === PaymentStatus.FAILED
            ? 'FAILED'
            : domainStatus === PaymentStatus.PAID || domainStatus === PaymentStatus.AUTHORIZED
              ? 'SUCCEEDED'
              : 'PROCESSING',
        providerPaymentId: providerResult.providerPaymentId,
        providerMetadata: providerResult.providerMetadata as Prisma.InputJsonValue,
        completedAt:
          domainStatus === PaymentStatus.FAILED ||
          domainStatus === PaymentStatus.PAID ||
          domainStatus === PaymentStatus.AUTHORIZED
            ? new Date()
            : null,
        ...(providerResult.failure?.code !== undefined
          ? { failureCode: providerResult.failure.code }
          : {}),
        ...(providerResult.failure?.message !== undefined
          ? { failureMessage: providerResult.failure.message }
          : {}),
      },
      tx,
    );

    await repo.updatePaymentRow(
      payment.id,
      {
        status: transition.status,
        providerPaymentId: providerResult.providerPaymentId,
        ...(providerResult.checkoutUrl !== undefined
          ? { checkoutUrl: providerResult.checkoutUrl }
          : {}),
        ...(providerResult.failure?.code !== undefined
          ? { failureCode: providerResult.failure.code }
          : {}),
        ...(providerResult.failure?.message !== undefined
          ? { failureMessage: providerResult.failure.message }
          : {}),
        ...(transition.authorizedAt !== undefined
          ? { authorizedAt: transition.authorizedAt }
          : {}),
        ...(transition.paidAt !== undefined ? { paidAt: transition.paidAt } : {}),
        ...(transition.failedAt !== undefined ? { failedAt: transition.failedAt } : {}),
      },
      tx,
    );

    await enqueueOutboxEvent(tx, {
      eventType:
        domainStatus === PaymentStatus.PAID
          ? 'payment.paid'
          : domainStatus === PaymentStatus.FAILED
            ? 'payment.failed'
            : 'payment.processing',
      organizationId: organization.id,
      sourceProduct: service.sourceProduct,
      resourceType: 'payment',
      resourceId: payment.id,
      payload: paymentPayload({
        id: payment.id,
        organizationId: organization.id,
        status: transition.status,
        amount: payment.amount,
        currency: payment.currency,
        externalReference: payment.externalReference,
        eventType:
          domainStatus === PaymentStatus.PAID
            ? 'payment.paid'
            : domainStatus === PaymentStatus.FAILED
              ? 'payment.failed'
              : 'payment.processing',
        provider: payment.provider,
        providerPaymentId: providerResult.providerPaymentId,
      }),
    });

    return (await repo.findPaymentById(payment.id, tx))!;
  });

  if (domainStatus === PaymentStatus.FAILED) {
    throw new AppError(
      ErrorCode.PAYMENT_DECLINED,
      providerResult.failure?.message ?? 'Payment was declined.',
      {
        details: [{ field: 'paymentId', issue: payment.id }],
      },
    );
  }

  return toPaymentResponse(payment, { latestAttemptOnly: true });
}

export async function getPayment(
  id: string,
  service: ServiceContext,
): Promise<PaymentResponse> {
  const payment = await repo.findPaymentById(id);
  if (!payment) {
    throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
  }
  await resolveOrganization(payment.organizationId, service.sourceProduct, 'read');
  return toPaymentResponse(payment, { includeCollections: true });
}

export async function listPayments(
  query: {
    organizationId: string;
    status?: string | string[];
    customerReference?: string;
    externalReference?: string;
    provider?: string;
    createdAfter?: string;
    createdBefore?: string;
    limit: number;
    cursor?: string;
  },
  service: ServiceContext,
): Promise<{ data: PaymentResponse[]; nextCursor: string | null }> {
  await resolveOrganization(query.organizationId, service.sourceProduct, 'read');

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

  const statuses = query.status
    ? (Array.isArray(query.status) ? query.status : [query.status]).map(
        (status) => status as PaymentStatus,
      )
    : undefined;

  const rows = await repo.listPayments({
    organizationId: query.organizationId,
    limit: query.limit,
    ...(statuses !== undefined ? { statuses } : {}),
    ...(query.customerReference !== undefined
      ? { customerReference: query.customerReference }
      : {}),
    ...(query.externalReference !== undefined
      ? { externalReference: query.externalReference }
      : {}),
    ...(query.provider !== undefined ? { provider: query.provider } : {}),
    ...(query.createdAfter !== undefined
      ? { createdAfter: new Date(query.createdAfter) }
      : {}),
    ...(query.createdBefore !== undefined
      ? { createdBefore: new Date(query.createdBefore) }
      : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map((row) => toPaymentResponse(row, { latestAttemptOnly: true })),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function retryPayment(
  id: string,
  service: ServiceContext,
  requestId: string,
): Promise<PaymentResponse> {
  const existing = await repo.findPaymentById(id);
  if (!existing) {
    throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
  }
  await resolveOrganization(existing.organizationId, service.sourceProduct, 'mutate');

  if (existing.status !== PaymentStatus.FAILED) {
    throw new AppError(
      ErrorCode.INVALID_PAYMENT_STATE,
      'Only FAILED payments can be retried.',
    );
  }

  const selected = await selectProvider({
    organizationId: existing.organizationId,
    paymentAccountId: existing.paymentAccountId,
    requestId,
    currency: existing.currency,
  });

  const nextAttemptNumber =
    existing.attempts.reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0) + 1;
  const metadata = existing.metadata as Record<string, string>;

  const providerResult = await selected.provider.createPayment(
    {
      paymentId: existing.id,
      amount: { amount: existing.amount, currency: existing.currency },
      customerReference: existing.customerReference,
      idempotencyKey: `${existing.id}:${nextAttemptNumber}`,
      metadata,
      ...(existing.description ? { description: existing.description } : {}),
    },
    selected.context,
  );

  const domainStatus = mapProviderStatusToDomain(providerResult.status);

  // FAILED -> PROCESSING is the only legal first hop; then apply the provider outcome.
  transitionPayment(PaymentStatus.FAILED, PaymentStatus.PROCESSING);
  const finalUpdate =
    domainStatus === PaymentStatus.PROCESSING
      ? { status: PaymentStatus.PROCESSING }
      : transitionPayment(PaymentStatus.PROCESSING, domainStatus);

  const payment = await repo.withTransaction(async (tx) => {
    await repo.createAttemptRow(
      {
        payment: { connect: { id: existing.id } },
        attemptNumber: nextAttemptNumber,
        provider: selected.provider.key,
        providerPaymentId: providerResult.providerPaymentId,
        status:
          finalUpdate.status === PaymentStatus.FAILED
            ? 'FAILED'
            : finalUpdate.status === PaymentStatus.PAID ||
                finalUpdate.status === PaymentStatus.AUTHORIZED
              ? 'SUCCEEDED'
              : 'PROCESSING',
        providerMetadata: providerResult.providerMetadata as Prisma.InputJsonValue,
        completedAt:
          finalUpdate.status === PaymentStatus.FAILED ||
          finalUpdate.status === PaymentStatus.PAID ||
          finalUpdate.status === PaymentStatus.AUTHORIZED
            ? new Date()
            : null,
        ...(providerResult.failure?.code !== undefined
          ? { failureCode: providerResult.failure.code }
          : {}),
        ...(providerResult.failure?.message !== undefined
          ? { failureMessage: providerResult.failure.message }
          : {}),
      },
      tx,
    );

    await repo.updatePaymentRow(
      existing.id,
      {
        status: finalUpdate.status,
        providerPaymentId: providerResult.providerPaymentId,
        checkoutUrl: providerResult.checkoutUrl ?? existing.checkoutUrl,
        failureCode: providerResult.failure?.code ?? null,
        failureMessage: providerResult.failure?.message ?? null,
        ...('paidAt' in finalUpdate && finalUpdate.paidAt !== undefined
          ? { paidAt: finalUpdate.paidAt }
          : {}),
        ...('authorizedAt' in finalUpdate && finalUpdate.authorizedAt !== undefined
          ? { authorizedAt: finalUpdate.authorizedAt }
          : {}),
        ...('failedAt' in finalUpdate && finalUpdate.failedAt !== undefined
          ? { failedAt: finalUpdate.failedAt }
          : {}),
      },
      tx,
    );

    return (await repo.findPaymentById(existing.id, tx))!;
  });

  return toPaymentResponse(payment, { includeCollections: true });
}

export async function cancelPayment(
  id: string,
  service: ServiceContext,
): Promise<PaymentResponse> {
  const existing = await repo.findPaymentById(id);
  if (!existing) {
    throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
  }
  await resolveOrganization(existing.organizationId, service.sourceProduct, 'mutate');

  if (
    existing.status !== PaymentStatus.PENDING &&
    existing.status !== PaymentStatus.PROCESSING
  ) {
    throw new AppError(
      ErrorCode.INVALID_PAYMENT_STATE,
      'Only PENDING or PROCESSING payments can be cancelled.',
    );
  }

  const update = transitionPayment(existing.status as never, PaymentStatus.CANCELLED);
  const payment = await repo.withTransaction(async (tx) => {
    await repo.updatePaymentRow(
      existing.id,
      {
        status: update.status,
        ...(update.cancelledAt !== undefined ? { cancelledAt: update.cancelledAt } : {}),
      },
      tx,
    );
    await enqueueOutboxEvent(tx, {
      eventType: 'payment.cancelled',
      organizationId: existing.organizationId,
      sourceProduct: existing.sourceProduct,
      resourceType: 'payment',
      resourceId: existing.id,
      payload: paymentPayload({
        id: existing.id,
        organizationId: existing.organizationId,
        status: PaymentStatus.CANCELLED,
        amount: existing.amount,
        currency: existing.currency,
        externalReference: existing.externalReference,
        eventType: 'payment.cancelled',
        provider: existing.provider,
        providerPaymentId: existing.providerPaymentId,
      }),
    });
    return (await repo.findPaymentById(existing.id, tx))!;
  });

  return toPaymentResponse(payment, { includeCollections: true });
}
