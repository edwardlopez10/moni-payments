import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';

loadDotenv({ path: resolve(process.cwd(), '.env') });

async function main(): Promise<void> {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: process.env.NODE_ENV === 'production' ? 'development' : process.env.NODE_ENV,
  });

  const app = await buildApp({ env });
  await app.ready();
  const document = app.swagger();
  await app.close();

  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const outPath = resolve(process.cwd(), 'openapi.json');
  let existing = '';
  try {
    existing = readFileSync(outPath, 'utf8');
  } catch {
    writeFileSync(outPath, serialized, 'utf8');
    console.error('openapi.json was missing; wrote a fresh copy. Re-run to verify.');
    process.exit(1);
  }

  if (existing !== serialized) {
    console.error('openapi.json is stale. Run `pnpm openapi:export` and commit the result.');
    process.exit(1);
  }

  console.log('openapi.json is up to date.');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
