import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { buildApp } from './app';
import { EnvValidationError, loadEnv } from './config/env';

loadDotenv({ path: resolve(process.cwd(), '.env') });

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      for (const issue of error.issues) {
        console.error(`  - ${issue.path}: ${issue.message}`);
      }
      process.exit(1);
    }
    throw error;
  }

  const app = await buildApp({ env });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
