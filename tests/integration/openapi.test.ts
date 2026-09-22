import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../../src/app';
import { loadEnv } from '../../src/config/env';

loadDotenv({ path: resolve(process.cwd(), '.env') });

function testEnv(overrides: Record<string, string | undefined> = {}) {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

describe('OpenAPI /docs', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Swagger UI in non-production environments', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.statusCode).toBe(200);
    expect(response.body.toLowerCase()).toContain('swagger');
  });

  it('documents health endpoints in the OpenAPI document', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const document = response.json() as {
      paths: Record<string, unknown>;
      tags?: Array<{ name: string }>;
    };
    expect(document.paths['/health']).toBeDefined();
    expect(document.paths['/ready']).toBeDefined();
    expect(document.tags?.some((tag) => tag.name === 'Health')).toBe(true);
  });
});

describe('OpenAPI /docs in production', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv({ NODE_ENV: 'production' }) });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for /docs', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.statusCode).toBe(404);
  });
});
