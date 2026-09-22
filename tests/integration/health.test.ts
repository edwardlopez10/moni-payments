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

describe('health and request context', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves GET /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('moniveo-payments');
  });

  it('echoes X-Request-Id when supplied and generates one when absent', async () => {
    const echoed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'client-req-123' },
    });
    expect(echoed.headers['x-request-id']).toBe('client-req-123');

    const generated = await app.inject({ method: 'GET', url: '/health' });
    expect(generated.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('returns INTERNAL_ERROR without leaking unmapped throw details', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test/unmapped-error' });
    expect(response.statusCode).toBe(500);
    const body = response.json() as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(body.error.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('returns ready when Postgres is up', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      checks: { database: { status: string } };
    };
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('ok');
  });
});

describe('readiness when database is unreachable', () => {
  let app: AppInstance;

  beforeAll(async () => {
    app = await buildApp({
      env: testEnv({
        DATABASE_URL: 'postgresql://moniveo:moniveo@127.0.0.1:1/moniveo_payments',
      }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 with per-check detail', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json() as {
      status: string;
      checks: { database: { status: string; error?: string } };
    };
    expect(body.status).toBe('not_ready');
    expect(body.checks.database.status).toBe('fail');
    expect(body.checks.database.error).toBeTruthy();
  });
});
