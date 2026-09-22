import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import * as providerService from './service';
import { providerDescriptorSchema, providerListResponseSchema } from './schema';

export const providerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/v1/providers',
    {
      schema: {
        tags: ['Providers'],
        response: { 200: providerListResponseSchema },
      },
    },
    async () => providerService.listProviders(),
  );

  app.get(
    '/v1/providers/:provider/capabilities',
    {
      schema: {
        tags: ['Providers'],
        params: z.object({ provider: z.string().min(1) }),
        response: { 200: providerDescriptorSchema },
      },
    },
    async (request) => providerService.getProviderCapabilities(request.params.provider),
  );
};
