import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError, ErrorCode } from '../../domain/errors';
import type { ServiceContext } from '../../platform/auth/service-auth';
import * as paymentAccountService from './service';
import {
  createPaymentAccountBodySchema,
  patchPaymentAccountBodySchema,
  paymentAccountListResponseSchema,
  paymentAccountResponseSchema,
} from './schema';

function requireService(ctx: ServiceContext | undefined): ServiceContext {
  if (!ctx) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required.');
  }
  return ctx;
}

const orgParamsSchema = z.object({ id: z.string().uuid() });
const accountParamsSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
});

export const paymentAccountRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/organizations/:id/payment-accounts',
    {
      schema: {
        tags: ['Payment Accounts'],
        params: orgParamsSchema,
        body: createPaymentAccountBodySchema,
        response: { 201: paymentAccountResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await paymentAccountService.createPaymentAccount(
        request.params.id,
        request.body,
        requireService(request.serviceContext),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/v1/organizations/:id/payment-accounts',
    {
      schema: {
        tags: ['Payment Accounts'],
        params: orgParamsSchema,
        response: { 200: paymentAccountListResponseSchema },
      },
    },
    async (request) =>
      paymentAccountService.listPaymentAccounts(
        request.params.id,
        requireService(request.serviceContext),
      ),
  );

  app.patch(
    '/v1/organizations/:id/payment-accounts/:accountId',
    {
      schema: {
        tags: ['Payment Accounts'],
        params: accountParamsSchema,
        body: patchPaymentAccountBodySchema,
        response: { 200: paymentAccountResponseSchema },
      },
    },
    async (request) =>
      paymentAccountService.patchPaymentAccount(
        request.params.id,
        request.params.accountId,
        request.body,
        requireService(request.serviceContext),
      ),
  );
};
