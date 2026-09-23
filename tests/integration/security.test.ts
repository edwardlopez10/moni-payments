import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';

import { createLogger, LOG_REDACT_PATHS } from '../../src/platform/logging/logger';
import { BODY_LIMIT_BYTES } from '../../src/platform/security/plugins';
import { FAKE_SIGNATURE_HEADER, signFakeWebhook } from '../../src/providers/fake';
import {
  authHeaders,
  closeTestApp,
  createTestApp,
  seedOrgWithFakeAccount,
  type TestAppContext,
} from '../helpers/app';

describe('security hardening', () => {
  describe('HTTP protections', () => {
    let ctx: TestAppContext;

    beforeAll(async () => {
      process.env.FAKE_PROVIDER_WEBHOOK_SECRET = 'test-fake-webhook-secret';
      ctx = await createTestApp({ webhookRateLimitMax: 5, rateLimitMax: 50 });
      await seedOrgWithFakeAccount(ctx.app, ctx.apiKey, 'sec-org');
    });

    afterAll(async () => {
      await closeTestApp(ctx);
    });

    it('returns helmet security headers', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/health' });
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
    });

    it('returns 413 for oversized bodies', async () => {
      const big = 'x'.repeat(BODY_LIMIT_BYTES + 1024);
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers: {
          ...authHeaders(ctx.apiKey, 'sec-big'),
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(JSON.stringify({ externalId: 'big', name: big }))),
        },
        body: JSON.stringify({ externalId: 'big', name: big }),
      });
      expect(response.statusCode).toBe(413);
    });

    it('returns 429 past the webhook rate limit', async () => {
      // Use distinct event ids so ingestion succeeds and only the rate limiter trips.
      let saw429 = false;
      for (let i = 0; i < 20; i += 1) {
        const rawBody = Buffer.from(
          JSON.stringify({
            kind: 'UNKNOWN',
            providerEventId: `rate-limit-probe-${i}`,
            providerEventType: 'probe',
          }),
          'utf8',
        );
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/v1/webhooks/fake',
          headers: {
            'content-type': 'application/json',
            [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, 'test-fake-webhook-secret'),
          },
          payload: rawBody,
        });
        if (response.statusCode === 429) {
          saw429 = true;
          break;
        }
      }
      expect(saw429).toBe(true);
    });
  });

  describe('log redaction', () => {
    it('redacts sensitive fields', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(String(chunk));
          cb();
        },
      });
      const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
      // Rebind destination via child is awkward with pino; build destination logger instead.
      const { default: pino } = await import('pino');
      const destLogger = pino(
        {
          level: 'info',
          redact: {
            paths: [...LOG_REDACT_PATHS],
            censor: '[REDACTED]',
          },
        },
        stream,
      );
      const canary = 'sec-canary-do-not-leak';
      destLogger.info({
        authorization: `Bearer ${canary}`,
        apiKey: 'mvp_x_secret',
        webhookSecret: 'whsec',
        credentials: { apiKey: canary },
        clientSecret: canary,
        SecretString: canary,
        setupToken: 'tok',
        rawBody: 'sensitive',
        safe: 'ok',
      });
      await new Promise((r) => setTimeout(r, 20));
      const joined = chunks.join('');
      expect(joined).toContain('[REDACTED]');
      expect(joined).not.toContain(canary);
      expect(joined).not.toContain('Bearer ');
      expect(joined).not.toContain('mvp_x_secret');
      expect(joined).not.toContain('whsec');
      expect(joined).toContain('"safe":"ok"');
      void logger;
    });
  });

  describe('PCI field absence', () => {
    it('never defines cardNumber, cvv, pan, or track2 in schemas or models', async () => {
      const { readdir, readFile, stat } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const roots = ['src', 'prisma'];
      const forbidden = /\b(cardNumber|cvv|pan|track2)\b/i;
      const hits: string[] = [];

      async function walk(dir: string): Promise<void> {
        let entries;
        try {
          entries = await readdir(dir);
        } catch {
          return;
        }
        for (const name of entries) {
          const full = join(dir, name);
          const info = await stat(full);
          if (info.isDirectory()) {
            await walk(full);
            continue;
          }
          if (!/\.(ts|prisma|sql)$/.test(name)) continue;
          const text = await readFile(full, 'utf8');
          for (const [i, line] of text.split('\n').entries()) {
            if (!forbidden.test(line)) continue;
            if (/never|forbid|prohibited|must not|do not|PCI|not store|absence|PAN-shaped|shaped material/i.test(line)) {
              continue;
            }
            hits.push(`${full}:${i + 1}:${line.trim()}`);
          }
        }
      }

      for (const root of roots) {
        await walk(join(process.cwd(), root));
      }
      expect(hits).toEqual([]);
    });
  });
});
