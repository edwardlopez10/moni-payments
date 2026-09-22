import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeTestApp, createTestApp, type TestAppContext } from '../helpers/app';

const DEV_ROUTES = [
  { method: 'POST' as const, url: '/dev/fake-provider/payments/00000000-0000-4000-8000-000000000001/succeed' },
  { method: 'POST' as const, url: '/dev/fake-provider/payments/00000000-0000-4000-8000-000000000001/fail' },
  { method: 'POST' as const, url: '/dev/fake-provider/payments/00000000-0000-4000-8000-000000000001/authorize' },
  { method: 'POST' as const, url: '/dev/fake-provider/payments/00000000-0000-4000-8000-000000000001/send-webhook' },
  { method: 'POST' as const, url: '/dev/fake-provider/payments/00000000-0000-4000-8000-000000000001/send-duplicate-webhook' },
  { method: 'POST' as const, url: '/dev/fake-provider/payments/00000000-0000-4000-8000-000000000001/send-out-of-order-webhook' },
  { method: 'POST' as const, url: '/dev/fake-provider/payments/00000000-0000-4000-8000-000000000001/chargeback' },
  { method: 'POST' as const, url: '/dev/fake-provider/refunds/00000000-0000-4000-8000-000000000001/succeed' },
  { method: 'POST' as const, url: '/dev/fake-provider/refunds/00000000-0000-4000-8000-000000000001/fail' },
  { method: 'POST' as const, url: '/dev/fake-provider/payment-methods/setup-token' },
  { method: 'POST' as const, url: '/dev/webhooks/00000000-0000-4000-8000-000000000001/retry' },
  { method: 'POST' as const, url: '/dev/outbox/00000000-0000-4000-8000-000000000001/redeliver' },
  { method: 'GET' as const, url: '/dev/outbox' },
];

describe('development routes', () => {
  describe('under NODE_ENV=production', () => {
    let ctx: TestAppContext;

    beforeAll(async () => {
      ctx = await createTestApp({ nodeEnv: 'production' });
    });

    afterAll(async () => {
      await closeTestApp(ctx);
    });

    it.each(DEV_ROUTES)('returns 404 for $method $url', async (route) => {
      const response =
        route.method === 'POST'
          ? await ctx.app.inject({
              method: 'POST',
              url: route.url,
              payload: {},
            })
          : await ctx.app.inject({
              method: 'GET',
              url: route.url,
            });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('under NODE_ENV=test', () => {
    let ctx: TestAppContext;

    beforeAll(async () => {
      ctx = await createTestApp();
    });

    afterAll(async () => {
      await closeTestApp(ctx);
    });

    it('exposes /dev/outbox', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/dev/outbox' });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    });
  });
});
