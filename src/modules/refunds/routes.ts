import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError, ErrorCode } from '../../domain/errors';
import type { ServiceContext } from '../../platform/auth/service-auth';
import * as refundService from './service';
import {
  createRefundBodySchema,
  refundListResponseSchema,
  refundResponseSchema,
} from './schema';

function requireService(ctx: ServiceContext | undefined): ServiceContext {
  if (!ctx) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required.');
  }
  return ctx;
}

const paymentParamsSchema = z.object({ id: z.string().uuid() });

export const refundRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/payments/:id/refunds',
    {
      schema: {
        tags: ['Refunds'],
        params: paymentParamsSchema,
        body: createRefundBodySchema,
        response: { 201: refundResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await refundService.createRefund(
        request.params.id,
        request.body,
        requireService(request.serviceContext),
        request.id,
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/v1/payments/:id/refunds',
    {
      schema: {
        tags: ['Refunds'],
        params: paymentParamsSchema,
        response: { 200: refundListResponseSchema },
      },
    },
    async (request) =>
      refundService.listRefunds(request.params.id, requireService(request.serviceContext)),
  );
};
