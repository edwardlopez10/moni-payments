import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp } from '../helpers/api';

describe('payment accounts API', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let prisma: Awaited<ReturnType<typeof createTestApp>>['prisma'];
  let apiKey: string;
  let organizationId: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    apiKey = ctx.apiKey;

    const org = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(apiKey, 'pa-org'),
      payload: { externalId: 'pa-org', name: 'PA Org' },
    });
    organizationId = org.json().id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates, lists, and patches accounts with credential redaction', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-create'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-1',
        isDefault: true,
        configuration: { checkoutMode: 'REDIRECT' },
        credentialRefs: {
          apiKey: 'env://FAKE_PROVIDER_API_KEY',
          webhookSecret: 'env://FAKE_PROVIDER_WEBHOOK_SECRET',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.status).toBe('ACTIVE');
    expect(body.credentialKeys).toEqual(['apiKey', 'webhookSecret']);
    expect(JSON.stringify(body)).not.toContain('test-fake-api-key');
    expect(JSON.stringify(body)).not.toContain('env://');

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey),
    });
    expect(listed.json().data).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${organizationId}/payment-accounts/${body.id}`,
      headers: authHeaders(apiKey, 'pa-patch'),
      payload: { status: 'DISABLED' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe('DISABLED');
  });

  it('rejects unregistered credential schemes and leaves unresolved refs pending', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-bad-scheme'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-bad',
        credentialRefs: { apiKey: 'vault://secret' },
      },
    });
    expect(bad.statusCode).toBe(422);

    const pending = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-pending'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-pending',
        credentialRefs: { apiKey: 'env://DOES_NOT_EXIST_FOR_SURE' },
      },
    });
    expect(pending.statusCode).toBe(201);
    expect(pending.json().status).toBe('PENDING_CONFIGURATION');
  });
});
