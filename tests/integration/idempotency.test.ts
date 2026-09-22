import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { buildApiKey, hashApiKey } from '../../src/platform/auth/service-auth';
import { createTestPrisma, resetDatabase } from '../helpers/db';

loadDotenv({ path: resolve(process.cwd(), '.env') });

describe('idempotency plugin', () => {
  const prisma = createTestPrisma();
  let app: AppInstance;
  let apiKey: string;

  beforeAll(async () => {
    await prisma.$connect();
    const env = loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
    });
    app = await buildApp({ env });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    apiKey = buildApiKey('idem', randomBytes(12).toString('base64url'));
    await prisma.serviceClient.create({
      data: {
        name: 'Idem Client',
        sourceProduct: 'RESIDENT',
        keyPrefix: 'idem',
        keyHash: hashApiKey(apiKey),
      },
    });
  });

  function authHeaders(
    idempotencyKey?: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      ...extra,
    };
    if (idempotencyKey !== undefined) {
      headers['idempotency-key'] = idempotencyKey;
    }
    return headers;
  }

  it('requires Idempotency-Key on mutations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/__test/idempotent',
      headers: authHeaders(),
      payload: { value: 'a' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('replays the same key and payload with Idempotency-Replayed', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/__test/idempotent',
      headers: authHeaders('key-1'),
      payload: { value: 'same' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().count).toBe(1);

    const second = await app.inject({
      method: 'POST',
      url: '/__test/idempotent',
      headers: authHeaders('key-1'),
      payload: { value: 'same' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.json().count).toBe(1);
  });

  it('rejects the same key with a different payload', async () => {
    await app.inject({
      method: 'POST',
      url: '/__test/idempotent',
      headers: authHeaders('key-2'),
      payload: { value: 'one' },
    });

    const conflict = await app.inject({
      method: 'POST',
      url: '/__test/idempotent',
      headers: authHeaders('key-2'),
      payload: { value: 'two' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('DUPLICATE_REQUEST');
  });

  it('allows retry after a 5xx failure with the same key', async () => {
    const failed = await app.inject({
      method: 'POST',
      url: '/__test/idempotent',
      headers: authHeaders('key-fail', { 'x-test-fail': '1' }),
      payload: { value: 'x' },
    });
    expect(failed.statusCode).toBe(500);

    const retry = await app.inject({
      method: 'POST',
      url: '/__test/idempotent',
      headers: authHeaders('key-fail'),
      payload: { value: 'x' },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotency-replayed']).toBeUndefined();
    expect(retry.json().value).toBe('x');

    const replay = await app.inject({
      method: 'POST',
      url: '/__test/idempotent',
      headers: authHeaders('key-fail'),
      payload: { value: 'x' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.json()).toEqual(retry.json());
  });
});
