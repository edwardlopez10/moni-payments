import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditingSecretsProvider, MemorySecretsProvider, setSecretsProviderForTests } from '../../src/platform/secrets';
import { authHeaders, createTestApp, seedOrgWithFakeAccount } from '../helpers/app';

const ROTATED_KEY = 'rotated-api-key';
const ROTATED_SECRET = 'rotated-webhook-secret';

describe('credential rotation', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let prisma: Awaited<ReturnType<typeof createTestApp>>['prisma'];
  let apiKey: string;
  let organizationId: string;
  let accountId: string;
  const memory = new MemorySecretsProvider();
  const previousProvider = process.env.SECRETS_PROVIDER;

  beforeAll(async () => {
    process.env.SECRETS_PROVIDER = 'memory';
    setSecretsProviderForTests(new AuditingSecretsProvider(memory));
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    apiKey = ctx.apiKey;
    organizationId = await seedOrgWithFakeAccount(app, apiKey, 'rotate-org');
    const account = await prisma.paymentAccount.findFirstOrThrow({
      where: { organizationId },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    if (previousProvider === undefined) {
      delete process.env.SECRETS_PROVIDER;
    } else {
      process.env.SECRETS_PROVIDER = previousProvider;
    }
    setSecretsProviderForTests(undefined);
    await app.close();
    await prisma.$disconnect();
  });

  it('replaces the stored bundle, hides values, and a later payment succeeds', async () => {
    const before = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: accountId } });
    const rotated = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/payment-accounts/${accountId}/credentials/rotate`,
      headers: authHeaders(apiKey, 'rotate-creds'),
      payload: {
        credentials: { apiKey: ROTATED_KEY, webhookSecret: ROTATED_SECRET },
      },
    });

    expect(rotated.statusCode).toBe(200);
    const body = rotated.json();
    expect(body.status).toBe('ACTIVE');
    expect(body.credentialsStale).toBe(false);
    expect(body.credentialKeys).toEqual(['apiKey', 'webhookSecret']);
    expect(body.credentialsUpdatedAt).not.toBe(before.credentialsUpdatedAt?.toISOString() ?? null);
    expect(JSON.stringify(body)).not.toContain(ROTATED_KEY);
    expect(JSON.stringify(body)).not.toContain(ROTATED_SECRET);

    const stored = await memory.get<Record<string, string>>(before.secretRef!);
    expect(stored).toEqual({ apiKey: ROTATED_KEY, webhookSecret: ROTATED_SECRET });

    const audits = await prisma.credentialAuditEvent.findMany({
      where: { paymentAccountId: accountId, operation: 'ROTATION' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe('SUCCESS');
    expect(JSON.stringify(audits)).not.toContain(ROTATED_KEY);

    const payment = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'rotate-pay'),
      payload: {
        organizationId,
        externalReference: 'rotate-fee',
        customerReference: 'cust-rotate',
        amount: 1500,
        currency: 'USD',
      },
    });
    expect(payment.statusCode).toBe(201);
    expect(payment.json().status).not.toBe('FAILED');

    await prisma.paymentAccount.update({
      where: { id: accountId },
      data: { credentialsUpdatedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/payment-accounts`,
      headers: authHeaders(apiKey),
    });
    const row = listed.json().data.find((item: { id: string }) => item.id === accountId);
    expect(row.credentialsStale).toBe(true);
    expect(JSON.stringify(listed.json())).not.toContain(ROTATED_KEY);
  });
});
