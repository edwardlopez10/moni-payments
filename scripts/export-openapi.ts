import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';

loadDotenv({ path: resolve(process.cwd(), '.env') });

async function exportOpenApi(): Promise<void> {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: process.env.NODE_ENV === 'production' ? 'development' : process.env.NODE_ENV,
  });

  const app = await buildApp({ env });
  await app.ready();

  const document = app.swagger();
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const outPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outPath, serialized, 'utf8');
  await app.close();
  console.log(`Wrote ${outPath}`);
}

void exportOpenApi().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
