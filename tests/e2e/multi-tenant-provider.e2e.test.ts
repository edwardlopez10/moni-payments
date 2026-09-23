import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakePaymentProvider } from '../../src/providers/fake';
import {
  createRegistry,
  setProviderRegistryForTests,
} from '../../src/providers/registry';
import {
  activatePaymentAccount,
  authHeaders,
  closeTestApp,
  createTestApp,
  fakeAccountCredentials,
  type TestAppContext,
} from '../helpers/app';

describe('e2e multi-tenant provider selection', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    process.env.FAKE_PROVIDER_WEBHOOK_SECRET = 'test-fake-webhook-secret';
    setProviderRegistryForTests(
      createRegistry([
        new FakePaymentProvider({ key: 'fake', displayName: 'Fake A' }),
        new FakePaymentProvider({ key: 'fake_b', displayName: 'Fake B' }),
      ]),
    );
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
    setProviderRegistryForTests(undefined);
  });

  it('routes two organizations to two registered providers without org branching', async () => {
    const orgA = await ctx.app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(ctx.apiKey, 'mt-org-a'),
      payload: { externalId: 'tenant-a', name: 'Tenant A' },
    });
    const orgB = await ctx.app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: authHeaders(ctx.apiKey, 'mt-org-b'),
      payload: { externalId: 'tenant-b', name: 'Tenant B' },
    });
    const organizationA = orgA.json().id as string;
    const organizationB = orgB.json().id as string;

    const accountA = await ctx.app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationA}/payment-accounts`,
      headers: authHeaders(ctx.apiKey, 'mt-acct-a'),
      payload: {
        provider: 'fake',
        providerMerchantId: 'MERCHANT-A',
        isDefault: true,
        credentials: fakeAccountCredentials(),
      },
    });
    const accountB = await ctx.app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationB}/payment-accounts`,
      headers: authHeaders(ctx.apiKey, 'mt-acct-b'),
      payload: {
        provider: 'fake_b',
        providerMerchantId: 'MERCHANT-B',
        isDefault: true,
        credentials: fakeAccountCredentials(),
      },
    });
    expect(accountA.statusCode).toBe(201);
    expect(accountB.statusCode).toBe(201);
    await activatePaymentAccount(
      ctx.app,
      ctx.apiKey,
      organizationA,
      accountA.json().id as string,
      'mt-acct-a',
    );
    await activatePaymentAccount(
      ctx.app,
      ctx.apiKey,
      organizationB,
      accountB.json().id as string,
      'mt-acct-b',
    );

    const payA = await ctx.app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ctx.apiKey, 'mt-pay-a'),
      payload: {
        organizationId: organizationA,
        externalReference: 'mt-fee-a',
        customerReference: 'c-a',
        amount: 1000,
        currency: 'USD',
        metadata: { fakeScenario: 'instant_success' },
      },
    });
    const payB = await ctx.app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ctx.apiKey, 'mt-pay-b'),
      payload: {
        organizationId: organizationB,
        externalReference: 'mt-fee-b',
        customerReference: 'c-b',
        amount: 2000,
        currency: 'USD',
        metadata: { fakeScenario: 'instant_success' },
      },
    });

    expect(payA.statusCode).toBe(201);
    expect(payB.statusCode).toBe(201);
    expect(payA.json().provider).toBe('fake');
    expect(payB.json().provider).toBe('fake_b');
    expect(payA.json().status).toBe('PAID');
    expect(payB.json().status).toBe('PAID');

    const rowA = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payA.json().id } });
    const rowB = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payB.json().id } });
    expect(rowA.provider).toBe('fake');
    expect(rowB.provider).toBe('fake_b');
    expect(rowA.paymentAccountId).not.toBe(rowB.paymentAccountId);
  });
});
