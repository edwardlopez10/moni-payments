import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '../../db/prisma';
import { AppError, ErrorCode } from '../../domain/errors';
import { processWebhookEvent } from '../../modules/webhooks/processor';
import { ingestWebhook } from '../../modules/webhooks/service';
import { getEventPublisher } from '../../platform/events/publisher';
import { getSecretsProvider } from '../../platform/secrets';
import {
  FAKE_SIGNATURE_HEADER,
  signFakeWebhook,
} from '../../providers/fake';

async function resolveWebhookSecret(provider: string): Promise<string> {
  const account = await prisma.paymentAccount.findFirst({
    where: { provider, status: { in: ['ACTIVE', 'PENDING_CONFIGURATION'] } },
  });
  const refs =
    account?.credentialRefs && typeof account.credentialRefs === 'object'
      ? (account.credentialRefs as Record<string, string>)
      : {};
  if (typeof refs.webhookSecret === 'string') {
    try {
      return await getSecretsProvider().resolve(refs.webhookSecret);
    } catch {
      // fall through
    }
  }
  return process.env.FAKE_PROVIDER_WEBHOOK_SECRET ?? 'test-fake-webhook-secret';
}

async function emitPaymentWebhook(input: {
  paymentId: string;
  status: string;
  providerEventId?: string;
  failureCode?: string;
}): Promise<{ eventId: string; duplicate: boolean }> {
  const payment = await prisma.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment || !payment.providerPaymentId) {
    throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
  }

  const secret = await resolveWebhookSecret(payment.provider);
  const providerEventId =
    input.providerEventId ?? `dev_evt_${payment.providerPaymentId}_${input.status.toLowerCase()}_${randomUUID().slice(0, 8)}`;

  const payload: Record<string, unknown> = {
    kind: 'PAYMENT',
    providerEventId,
    providerEventType: `payment.${input.status.toLowerCase()}`,
    providerPaymentId: payment.providerPaymentId,
    status: input.status,
    amount: { amount: payment.amount, currency: payment.currency },
    occurredAt: new Date().toISOString(),
  };
  if (input.failureCode) {
    payload.failure = {
      code: input.failureCode,
      message: `Simulated failure ${input.failureCode}`,
      retryable: false,
    };
  }

  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const result = await ingestWebhook({
    providerKey: payment.provider,
    rawBody,
    headers: {
      'content-type': 'application/json',
      [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, secret),
    },
    query: {},
  });

  if (!result.duplicate) {
    await processWebhookEvent(result.eventId);
  }

  return { eventId: result.eventId, duplicate: result.duplicate };
}

export const fakeProviderDevRoutes: FastifyPluginAsyncZod = async (app) => {
  const paymentParams = z.object({ id: z.string().uuid() });

  app.post(
    '/dev/fake-provider/payments/:id/succeed',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        response: { 202: z.object({ eventId: z.string(), duplicate: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const result = await emitPaymentWebhook({
        paymentId: request.params.id,
        status: 'PAID',
      });
      return reply.status(202).send(result);
    },
  );

  app.post(
    '/dev/fake-provider/payments/:id/fail',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        body: z.object({ failureCode: z.string().default('PAYMENT_DECLINED') }).strict(),
        response: { 202: z.object({ eventId: z.string(), duplicate: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const result = await emitPaymentWebhook({
        paymentId: request.params.id,
        status: 'FAILED',
        failureCode: request.body.failureCode,
      });
      return reply.status(202).send(result);
    },
  );

  app.post(
    '/dev/fake-provider/payments/:id/authorize',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        response: { 202: z.object({ eventId: z.string(), duplicate: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const result = await emitPaymentWebhook({
        paymentId: request.params.id,
        status: 'AUTHORIZED',
      });
      return reply.status(202).send(result);
    },
  );

  app.post(
    '/dev/fake-provider/payments/:id/send-webhook',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        body: z
          .object({
            status: z.string().optional(),
            delayMs: z.number().int().nonnegative().optional(),
          })
          .strict(),
        response: { 202: z.object({ eventId: z.string(), duplicate: z.boolean() }) },
      },
    },
    async (request, reply) => {
      if (request.body.delayMs && request.body.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, request.body.delayMs));
      }
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: request.params.id } });
      const result = await emitPaymentWebhook({
        paymentId: request.params.id,
        status: request.body.status ?? payment.status,
      });
      return reply.status(202).send(result);
    },
  );

  app.post(
    '/dev/fake-provider/payments/:id/send-duplicate-webhook',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        response: { 202: z.object({ eventId: z.string(), duplicate: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: request.params.id } });
      const last = await prisma.webhookEvent.findFirst({
        where: { paymentId: payment.id },
        orderBy: { receivedAt: 'desc' },
      });
      const providerEventId =
        last?.providerEventId ?? `dev_dup_${payment.providerPaymentId ?? payment.id}`;
      const result = await emitPaymentWebhook({
        paymentId: request.params.id,
        status: payment.status === 'PAID' ? 'PAID' : 'PROCESSING',
        providerEventId,
      });
      return reply.status(202).send(result);
    },
  );

  app.post(
    '/dev/fake-provider/payments/:id/send-out-of-order-webhook',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        response: {
          202: z.object({
            events: z.array(z.object({ eventId: z.string(), duplicate: z.boolean() })),
          }),
        },
      },
    },
    async (request, reply) => {
      const paid = await emitPaymentWebhook({
        paymentId: request.params.id,
        status: 'PAID',
      });
      const processing = await emitPaymentWebhook({
        paymentId: request.params.id,
        status: 'PROCESSING',
      });
      return reply.status(202).send({ events: [paid, processing] });
    },
  );

  app.post(
    '/dev/fake-provider/payments/:id/chargeback',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        response: { 202: z.object({ eventId: z.string(), duplicate: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const result = await emitPaymentWebhook({
        paymentId: request.params.id,
        status: 'CHARGEBACK',
      });
      return reply.status(202).send(result);
    },
  );

  app.post(
    '/dev/fake-provider/refunds/:id/succeed',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        response: { 202: z.object({ received: z.literal(true) }) },
      },
    },
    async (request, reply) => {
      const refund = await prisma.refund.findUnique({ where: { id: request.params.id } });
      if (!refund || !refund.providerRefundId) {
        throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Refund not found.');
      }
      const secret = await resolveWebhookSecret(refund.provider);
      const payment = await prisma.payment.findUnique({ where: { id: refund.paymentId } });
      const payload: Record<string, unknown> = {
        kind: 'REFUND',
        providerEventId: `dev_rfnd_ok_${refund.providerRefundId}`,
        providerEventType: 'refund.succeeded',
        providerRefundId: refund.providerRefundId,
        status: 'SUCCEEDED',
      };
      if (payment?.providerPaymentId) {
        payload.providerPaymentId = payment.providerPaymentId;
      }
      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
      const ingested = await ingestWebhook({
        providerKey: refund.provider,
        rawBody,
        headers: {
          'content-type': 'application/json',
          [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, secret),
        },
        query: {},
      });
      if (!ingested.duplicate) {
        await processWebhookEvent(ingested.eventId);
      }
      return reply.status(202).send({ received: true as const });
    },
  );

  app.post(
    '/dev/fake-provider/refunds/:id/fail',
    {
      schema: {
        tags: ['Development'],
        params: paymentParams,
        response: { 202: z.object({ received: z.literal(true) }) },
      },
    },
    async (request, reply) => {
      const refund = await prisma.refund.findUnique({ where: { id: request.params.id } });
      if (!refund || !refund.providerRefundId) {
        throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Refund not found.');
      }
      const secret = await resolveWebhookSecret(refund.provider);
      const payload = {
        kind: 'REFUND',
        providerEventId: `dev_rfnd_fail_${refund.providerRefundId}`,
        providerEventType: 'refund.failed',
        providerRefundId: refund.providerRefundId,
        status: 'FAILED',
        failure: {
          code: 'REFUND_NOT_ALLOWED',
          message: 'Simulated refund failure',
          retryable: false,
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
      const ingested = await ingestWebhook({
        providerKey: refund.provider,
        rawBody,
        headers: {
          'content-type': 'application/json',
          [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, secret),
        },
        query: {},
      });
      if (!ingested.duplicate) {
        await processWebhookEvent(ingested.eventId);
      }
      return reply.status(202).send({ received: true as const });
    },
  );

  app.post(
    '/dev/fake-provider/payment-methods/setup-token',
    {
      schema: {
        tags: ['Development'],
        body: z
          .object({
            brand: z.string().default('visa'),
            last4: z.string().length(4).default('4242'),
          })
          .strict(),
        response: {
          200: z.object({
            setupToken: z.string(),
            brand: z.string(),
            last4: z.string(),
          }),
        },
      },
    },
    async (request) => ({
      setupToken: `fake_setup_${randomUUID().replace(/-/g, '')}`,
      brand: request.body.brand,
      last4: request.body.last4,
    }),
  );

  app.post(
    '/dev/webhooks/:eventId/retry',
    {
      schema: {
        tags: ['Development'],
        params: z.object({ eventId: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await prisma.webhookEvent.update({
        where: { id: request.params.eventId },
        data: {
          processingStatus: 'RECEIVED',
          nextRetryAt: null,
          error: null,
        },
      });
      await processWebhookEvent(request.params.eventId);
      return { ok: true as const };
    },
  );

  app.post(
    '/dev/outbox/:eventId/redeliver',
    {
      schema: {
        tags: ['Development'],
        params: z.object({ eventId: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const event = await prisma.outboxEvent.findFirst({
        where: { OR: [{ id: request.params.eventId }, { eventId: request.params.eventId }] },
      });
      if (!event) {
        throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, 'Outbox event not found.');
      }
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PENDING',
          nextAttemptAt: new Date(0),
          lastError: null,
        },
      });
      // Keep the same eventId for consumer dedupe on redelivery.
      await getEventPublisher().deliver({ ...event, attempts: event.attempts });
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'DELIVERED', deliveredAt: new Date(), attempts: event.attempts + 1 },
      });
      return { ok: true as const };
    },
  );

  app.get(
    '/dev/outbox',
    {
      schema: {
        tags: ['Development'],
        querystring: z.object({
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: {
          200: z.object({
            data: z.array(z.record(z.string(), z.unknown())),
          }),
        },
      },
    },
    async (request) => {
      const rows = await prisma.outboxEvent.findMany({
        ...(request.query.status ? { where: { status: request.query.status as never } } : {}),
        orderBy: { createdAt: 'desc' },
        take: request.query.limit,
      });
      return {
        data: rows.map((row) => ({
          id: row.id,
          eventId: row.eventId,
          eventType: row.eventType,
          status: row.status,
          attempts: row.attempts,
          lastError: row.lastError,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          nextAttemptAt: row.nextAttemptAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          deliveredAt: row.deliveredAt?.toISOString() ?? null,
        })),
      };
    },
  );
};
