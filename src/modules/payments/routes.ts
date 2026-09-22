import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError, ErrorCode } from '../../domain/errors';
import type { ServiceContext } from '../../platform/auth/service-auth';
import * as paymentService from './service';
import {
  createPaymentBodySchema,
  listPaymentsQuerySchema,
  paymentListResponseSchema,
  paymentResponseSchema,
} from './schema';

function requireService(ctx: ServiceContext | undefined): ServiceContext {
  if (!ctx) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required.');
  }
  return ctx;
}

const idParamsSchema = z.object({ id: z.string().uuid() });

export const paymentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/payments',
    {
      schema: {
        tags: ['Payments'],
        body: createPaymentBodySchema,
        response: {
          201: paymentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await paymentService.createPayment(
        request.body,
        requireService(request.serviceContext),
        request.id,
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/v1/payments/:id',
    {
      schema: {
        tags: ['Payments'],
        params: idParamsSchema,
        response: { 200: paymentResponseSchema },
      },
    },
    async (request) =>
      paymentService.getPayment(request.params.id, requireService(request.serviceContext)),
  );

  app.get(
    '/v1/payments',
    {
      schema: {
        tags: ['Payments'],
        querystring: listPaymentsQuerySchema,
        response: { 200: paymentListResponseSchema },
      },
    },
    async (request) => {
      const {
        organizationId,
        limit,
        status,
        customerReference,
        externalReference,
        provider,
        createdAfter,
        createdBefore,
        cursor,
      } = request.query;
      return paymentService.listPayments(
        {
          organizationId,
          limit,
          ...(status !== undefined ? { status } : {}),
          ...(customerReference !== undefined ? { customerReference } : {}),
          ...(externalReference !== undefined ? { externalReference } : {}),
          ...(provider !== undefined ? { provider } : {}),
          ...(createdAfter !== undefined ? { createdAfter } : {}),
          ...(createdBefore !== undefined ? { createdBefore } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
        },
        requireService(request.serviceContext),
      );
    },
  );

  app.post(
    '/v1/payments/:id/retry',
    {
      schema: {
        tags: ['Payments'],
        params: idParamsSchema,
        response: { 200: paymentResponseSchema },
      },
    },
    async (request) =>
      paymentService.retryPayment(
        request.params.id,
        requireService(request.serviceContext),
        request.id,
      ),
  );

  app.post(
    '/v1/payments/:id/cancel',
    {
      schema: {
        tags: ['Payments'],
        params: idParamsSchema,
        response: { 200: paymentResponseSchema },
      },
    },
    async (request) =>
      paymentService.cancelPayment(request.params.id, requireService(request.serviceContext)),
  );
};
