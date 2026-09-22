import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp } from '../helpers/api';

describe('organizations API', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let prisma: Awaited<ReturnType<typeof createTestApp>>['prisma'];
  let apiKey: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    apiKey = ctx.apiKey;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates, gets, and lists by externalId; ignores body sourceProduct', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(apiKey, 'org-create-1'),
      payload: {
        externalId: 'condo-1',
        name: 'Condo One',
        sourceProduct: 'HEALTH',
        metadata: { region: 'sv' },
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.sourceProduct).toBe('RESIDENT');
    expect(body.externalId).toBe('condo-1');

    const got = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${body.id}`,
      headers: authHeaders(apiKey),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(body.id);

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/organizations?externalId=condo-1',
      headers: authHeaders(apiKey),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(1);
  });

  it('rejects duplicate externalId with 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(apiKey, 'org-dup-1'),
      payload: { externalId: 'dup-org', name: 'A' },
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(apiKey, 'org-dup-2'),
      payload: { externalId: 'dup-org', name: 'B' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('DUPLICATE_EXTERNAL_REFERENCE');
  });

  it('returns 404 for cross-product access', async () => {
    const healthKeyPrefix = 'healthx';
    const { buildApiKey, hashApiKey } = await import('../../src/platform/auth/service-auth');
    const { randomBytes } = await import('node:crypto');
    const healthKey = buildApiKey(healthKeyPrefix, randomBytes(8).toString('base64url'));
    await prisma.serviceClient.create({
      data: {
        name: 'Health Client',
        sourceProduct: 'HEALTH',
        keyPrefix: healthKeyPrefix,
        keyHash: hashApiKey(healthKey),
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(apiKey, 'org-cross-1'),
      payload: { externalId: 'resident-only', name: 'R' },
    });
    const id = created.json().id;

    const cross = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${id}`,
      headers: authHeaders(healthKey),
    });
    expect(cross.statusCode).toBe(404);
    expect(cross.json().error.code).toBe('ORGANIZATION_NOT_FOUND');
  });
});
