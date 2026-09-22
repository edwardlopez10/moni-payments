import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(process.cwd(), '.env') });

/**
 * Runs once per Vitest process: apply migrations to TEST_DATABASE_URL.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for global setup');
  }

  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: url,
    },
    cwd: process.cwd(),
  });
}
