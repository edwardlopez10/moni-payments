import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from '../../../src/config/env';

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
      PORT: '4000',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://moniveo:moniveo@localhost:5433/moniveo_payments',
      SECRETS_PROVIDER: 'env',
    });

    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_URL).toContain('moniveo_payments');
  });

  it('aggregates every offending variable name into one error', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'nope',
        PORT: 'not-a-number',
        LOG_LEVEL: 'info',
        SECRETS_PROVIDER: 'env',
      }),
    ).toThrow(EnvValidationError);

    try {
      loadEnv({
        NODE_ENV: 'nope',
        PORT: 'not-a-number',
        LOG_LEVEL: 'info',
        SECRETS_PROVIDER: 'env',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).toContain('NODE_ENV');
      expect(message).toContain('PORT');
      expect(message).toContain('DATABASE_URL');
    }
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'development',
        PORT: '4000',
        LOG_LEVEL: 'info',
        SECRETS_PROVIDER: 'env',
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
