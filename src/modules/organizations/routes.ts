import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError, ErrorCode } from '../../domain/errors';
import type { ServiceContext } from '../../platform/auth/service-auth';
import * as organizationService from './service';
import {
  createOrganizationBodySchema,
  listOrganizationsQuerySchema,
  organizationListResponseSchema,
  organizationResponseSchema,
} from './schema';

function requireService(ctx: ServiceContext | undefined): ServiceContext {
  if (!ctx) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required.');
  }
  return ctx;
}

const idParamsSchema = z.object({ id: z.string().uuid() });

export const organizationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/v1/organizations',
    {
      schema: {
        tags: ['Organizations'],
        body: createOrganizationBodySchema,
        response: { 201: organizationResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await organizationService.createOrganization(
        request.body,
        requireService(request.serviceContext),
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/v1/organizations/:id',
    {
      schema: {
        tags: ['Organizations'],
        params: idParamsSchema,
        response: { 200: organizationResponseSchema },
      },
    },
    async (request) =>
      organizationService.getOrganization(
        request.params.id,
        requireService(request.serviceContext),
      ),
  );

  app.get(
    '/v1/organizations',
    {
      schema: {
        tags: ['Organizations'],
        querystring: listOrganizationsQuerySchema,
        response: { 200: organizationListResponseSchema },
      },
    },
    async (request) => {
      const { limit, externalId, cursor } = request.query;
      return organizationService.listOrganizations(
        {
          limit,
          ...(externalId !== undefined ? { externalId } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
        },
        requireService(request.serviceContext),
      );
    },
  );
};
