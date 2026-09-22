import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, type AppInstance } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { buildApiKey, hashApiKey } from '../../src/platform/auth/service-auth';
import { createTestPrisma, resetDatabase } from '../helpers/db';

loadDotenv({ path: resolve(process.cwd(), '.env') });

describe('service authentication', () => {
  const prisma = createTestPrisma();
  let app: AppInstance;
  let apiKey: string;
  let revokedKey: string;

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

    apiKey = buildApiKey('authok', randomBytes(12).toString('base64url'));
    await prisma.serviceClient.create({
      data: {
        name: 'Active Client',
        sourceProduct: 'RESIDENT',
        keyPrefix: 'authok',
        keyHash: hashApiKey(apiKey),
        scopes: ['*'],
      },
    });

    revokedKey = buildApiKey('revoked', randomBytes(12).toString('base64url'));
    await prisma.serviceClient.create({
      data: {
        name: 'Revoked Client',
        sourceProduct: 'RESIDENT',
        keyPrefix: 'revoked',
        keyHash: hashApiKey(revokedKey),
        status: 'REVOKED',
        revokedAt: new Date(),
      },
    });
  });

  async function getMe(authorization?: string) {
    return app.inject({
      method: 'GET',
      url: '/__test/auth/me',
      headers: authorization ? { authorization } : {},
    });
  }

  it('authenticates a valid API key', async () => {
    const response = await getMe(`Bearer ${apiKey}`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { sourceProduct: string };
    expect(body.sourceProduct).toBe('RESIDENT');
  });

  it('returns identical 401 bodies for missing, malformed, revoked, and unknown keys', async () => {
    const cases = [
      await getMe(),
      await getMe('Bearer not-a-key'),
      await getMe(`Bearer ${revokedKey}`),
      await getMe('Bearer mvp_unknown_secret'),
    ];

    for (const response of cases) {
      expect(response.statusCode).toBe(401);
    }

    const normalized = cases.map((response) => {
      const body = response.json() as {
        error: { code: string; message: string; requestId: string };
      };
      return { code: body.error.code, message: body.error.message };
    });

    expect(new Set(normalized.map((item) => JSON.stringify(item))).size).toBe(1);
    expect(normalized[0]).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
    for (const response of cases) {
      expect(response.body).not.toContain(apiKey);
      expect(response.body).not.toContain(revokedKey);
    }
  });
});
