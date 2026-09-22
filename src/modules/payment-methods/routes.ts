import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError, ErrorCode } from '../../domain/errors';
import type { ServiceContext } from '../../platform/auth/service-auth';
import * as paymentMethodService from './service';
import {
  createPaymentMethodBodySchema,
  paymentMethodListResponseSchema,
  paymentMethodResponseSchema,
} from './schema';

function requireService(ctx: ServiceContext | undefined): ServiceContext {
  if (!ctx) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required.');
  }
  return ctx;
}

const customerParamsSchema = z.object({
  organizationId: z.string().uuid(),
  customerReference: z.string().min(1),
});

const methodParamsSchema = customerParamsSchema.extend({
  id: z.string().uuid(),
});

export const paymentMethodRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/v1/organizations/:organizationId/customers/:customerReference/payment-methods',
    {
      schema: {
        tags: ['Payment Methods'],
        params: customerParamsSchema,
        response: { 200: paymentMethodListResponseSchema },
      },
    },
    async (request) =>
      paymentMethodService.listPaymentMethods(
        request.params.organizationId,
        request.params.customerReference,
        requireService(request.serviceContext),
      ),
  );

  app.post(
    '/v1/organizations/:organizationId/customers/:customerReference/payment-methods',
    {
      schema: {
        tags: ['Payment Methods'],
        params: customerParamsSchema,
        body: createPaymentMethodBodySchema,
        response: { 201: paymentMethodResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await paymentMethodService.createPaymentMethod(
        request.params.organizationId,
        request.params.customerReference,
        request.body,
        requireService(request.serviceContext),
        request.id,
      );
      return reply.status(201).send(result);
    },
  );

  app.delete(
    '/v1/organizations/:organizationId/customers/:customerReference/payment-methods/:id',
    {
      schema: {
        tags: ['Payment Methods'],
        params: methodParamsSchema,
        response: { 200: paymentMethodResponseSchema },
      },
    },
    async (request) =>
      paymentMethodService.revokePaymentMethod(
        request.params.organizationId,
        request.params.customerReference,
        request.params.id,
        requireService(request.serviceContext),
      ),
  );
};
