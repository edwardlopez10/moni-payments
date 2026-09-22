import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

loadDotenv({ path: resolve(process.cwd(), '.env') });

export function createTestPrisma(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for integration tests');
  }

  return new PrismaClient({
    datasources: { db: { url } },
    log: ['error'],
  });
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      outbox_events,
      event_subscriptions,
      webhook_events,
      idempotency_keys,
      refunds,
      payment_attempts,
      payments,
      payment_methods,
      payment_accounts,
      organizations,
      service_clients
    RESTART IDENTITY CASCADE;
  `);
}
