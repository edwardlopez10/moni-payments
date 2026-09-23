import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ErrorCode, AppError } from '../../src/domain/errors';
import { getSecretsProvider, setSecretsProviderForTests } from '../../src/platform/secrets';
import { authHeaders, createTestApp, seedOrgWithFakeAccount } from '../helpers/api';

describe('secret store outage', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let prisma: Awaited<ReturnType<typeof createTestApp>>['prisma'];
  let apiKey: string;
  let organizationId: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    apiKey = ctx.apiKey;
    organizationId = await seedOrgWithFakeAccount(app, apiKey, 'outage-org');
  });

  afterAll(async () => {
    setSecretsProviderForTests(undefined);
    await app.close();
    await prisma.$disconnect();
  });

  it('returns 503 and creates no failed payment, then the same idempotency key can succeed', async () => {
    const real = getSecretsProvider();
    setSecretsProviderForTests({
      ...real,
      get: async () => {
        throw new AppError(
          ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE,
          'Secret store temporarily unavailable.',
        );
      },
    });

    const payload = {
      organizationId,
      externalReference: 'outage-fee',
      customerReference: 'cust-outage',
      amount: 1000,
      currency: 'USD',
    };

    const failed = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'outage-pay'),
      payload,
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe(ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE);

    const duringOutage = await prisma.payment.findMany({
      where: { organizationId, externalReference: 'outage-fee' },
    });
    expect(duringOutage).toHaveLength(0);
    expect(duringOutage.some((row) => row.status === 'FAILED')).toBe(false);

    setSecretsProviderForTests(undefined);

    const retried = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(apiKey, 'outage-pay'),
      payload,
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json().status).not.toBe('FAILED');
  });
});
