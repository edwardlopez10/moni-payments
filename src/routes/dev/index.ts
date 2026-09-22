import type { FastifyPluginAsync } from 'fastify';

import { fakeProviderDevRoutes } from './fake-provider';

/**
 * Development/test-only routes. Registered only when NODE_ENV is development or test
 * so they do not exist (standard 404) in production.
 */
export const devRoutes: FastifyPluginAsync = async (app) => {
  await app.register(fakeProviderDevRoutes);
};
