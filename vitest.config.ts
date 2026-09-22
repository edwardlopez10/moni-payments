import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadDotenv({ path: resolve(process.cwd(), '.env') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    // Integration tests share one Postgres database; parallel files would truncate each other.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
