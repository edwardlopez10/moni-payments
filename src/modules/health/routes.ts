import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { SERVICE_NAME, SERVICE_VERSION } from '../../config/constants';

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number(),
});

const checkSchema = z.object({
  status: z.enum(['ok', 'fail']),
  latencyMs: z.number().optional(),
  pending: z.number().optional(),
  registered: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const readyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: checkSchema,
    migrations: checkSchema,
    providers: checkSchema,
  }),
});

export interface HealthRouteDeps {
  pool: Pool;
  getRegisteredProviders: () => string[];
  startedAt: number;
}

async function checkDatabase(pool: Pool): Promise<z.infer<typeof checkSchema>> {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: 'fail',
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'database unreachable',
    };
  }
}

async function checkMigrations(pool: Pool): Promise<z.infer<typeof checkSchema>> {
  try {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = '_prisma_migrations'
       ) AS exists`,
    );
    const tableExists = result.rows[0]?.exists ?? false;
    if (!tableExists) {
      // Pre-migration bootstrap (Phase 0): no migrations table yet.
      return { status: 'ok', pending: 0 };
    }

    const pending = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM _prisma_migrations
       WHERE finished_at IS NULL`,
    );
    const count = Number(pending.rows[0]?.count ?? '0');
    return count === 0
      ? { status: 'ok', pending: 0 }
      : { status: 'fail', pending: count, error: `${count} pending migration(s)` };
  } catch (error) {
    return {
      status: 'fail',
      error: error instanceof Error ? error.message : 'migration check failed',
    };
  }
}

export const healthRoutes: FastifyPluginAsync<HealthRouteDeps> = async (app, deps) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        security: [],
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
    }),
  );

  app.get(
    '/ready',
    {
      schema: {
        tags: ['Health'],
        security: [],
        response: {
          200: readyResponseSchema,
          503: readyResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const [database, migrations] = await Promise.all([
        checkDatabase(deps.pool),
        checkMigrations(deps.pool),
      ]);
      const providers = {
        status: 'ok' as const,
        registered: deps.getRegisteredProviders(),
      };

      const ready =
        database.status === 'ok' && migrations.status === 'ok' && providers.status === 'ok';

      const body = {
        status: ready ? ('ready' as const) : ('not_ready' as const),
        checks: { database, migrations, providers },
      };

      return reply.status(ready ? 200 : 503).send(body);
    },
  );
};
