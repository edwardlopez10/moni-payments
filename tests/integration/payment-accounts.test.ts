import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestApp } from '../helpers/api';
import { activatePaymentAccount } from '../helpers/app';

const CANARY = 'canary-credential-value';

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

  it('writes credentials without returning them and follows the lifecycle', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-create'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-1',
        isDefault: true,
        configuration: { checkoutMode: 'REDIRECT' },
        credentials: {
          apiKey: CANARY,
          webhookSecret: 'whsec-canary',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.status).toBe('ONBOARDING');
    expect(body.credentialKeys).toEqual(['apiKey', 'webhookSecret']);
    expect(body.credentialsUpdatedAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(JSON.stringify(body)).not.toContain('whsec-canary');
    expect(JSON.stringify(body)).not.toContain('env://');
    expect(JSON.stringify(body)).not.toContain('secretRef');

    const verifying = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${organizationId}/payment-accounts/${body.id}`,
      headers: authHeaders(apiKey, 'pa-verify'),
      payload: { status: 'PENDING_VERIFICATION' },
    });
    expect(verifying.statusCode).toBe(200);

    const active = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${organizationId}/payment-accounts/${body.id}`,
      headers: authHeaders(apiKey, 'pa-active'),
      payload: { status: 'ACTIVE' },
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().status).toBe('ACTIVE');

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${organizationId}/payment-accounts/${body.id}`,
      headers: authHeaders(apiKey, 'pa-disable'),
      payload: { status: 'DISABLED' },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().status).toBe('DISABLED');

    const audits = await prisma.credentialAuditEvent.findMany({
      where: { paymentAccountId: body.id },
      orderBy: { createdAt: 'asc' },
    });
    const operations = audits.map((row) => row.operation);
    expect(operations).toContain('PUT');
    expect(operations).toContain('LIFECYCLE');
    expect(operations).toContain('DELETE');
    expect(audits.every((row) => row.actorType === 'SERVICE_CLIENT')).toBe(true);
    expect(audits.every((row) => row.organizationId === organizationId)).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(CANARY);
    expect(JSON.stringify(audits)).not.toContain('whsec-canary');
  });

  it('rejects caller-supplied references, invalid credentials, and illegal transitions', async () => {
    const refs = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-refs'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-refs',
        credentialRefs: { apiKey: 'env://FAKE_PROVIDER_API_KEY' },
      },
    });
    expect(refs.statusCode).toBe(422);

    const invalid = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-invalid'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-invalid',
        credentials: { apiKey: 'only-one' },
      },
    });
    expect(invalid.statusCode).toBe(422);

    const bare = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-bare'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-bare',
      },
    });
    expect(bare.statusCode).toBe(201);
    expect(bare.json().status).toBe('NOT_CONFIGURED');

    const skipped = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${organizationId}/payment-accounts/${bare.json().id}`,
      headers: authHeaders(apiKey, 'pa-skip'),
      payload: { status: 'ACTIVE' },
    });
    expect(skipped.statusCode).toBe(409);
    expect(skipped.json().error.code).toBe('INVALID_PAYMENT_STATE');
  });

  it('keeps a single default account', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-def-1'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-def-1',
        isDefault: true,
        credentials: { apiKey: 'a', webhookSecret: 'b' },
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-def-2'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-def-2',
        isDefault: true,
        credentials: { apiKey: 'c', webhookSecret: 'd' },
      },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey),
    });
    const defaults = listed.json().data.filter((row: { isDefault: boolean }) => row.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.json().id);
  });

  it('refuses a suspended account and does not create a failed payment', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey, 'pa-susp-create'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'M-suspended',
        isDefault: false,
        credentials: { apiKey: CANARY, webhookSecret: 'whsec-canary' },
      },
    });
    expect(created.statusCode).toBe(201);
    const accountId = created.json().id as string;
    await activatePaymentAccount(app, apiKey, organizationId, accountId, 'pa-susp');

    const suspended = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${organizationId}/payment-accounts/${accountId}`,
      headers: authHeaders(apiKey, 'pa-susp-status'),
      payload: { status: 'SUSPENDED' },
    });
    expect(suspended.statusCode).toBe(200);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'pa-susp-pay'),
      payload: {
        organizationId,
        paymentAccountId: accountId,
        externalReference: 'pa-suspended-fee',
        customerReference: 'cust-susp',
        amount: 1000,
        currency: 'USD',
      },
    });
    expect(payment.statusCode).toBe(422);
    expect(payment.json().error.code).toBe('PROVIDER_CONFIGURATION_ERROR');
    expect(JSON.stringify(payment.json())).not.toContain(CANARY);

    const rows = await prisma.payment.findMany({
      where: { organizationId, externalReference: 'pa-suspended-fee' },
    });
    expect(rows).toHaveLength(0);
  });
});
