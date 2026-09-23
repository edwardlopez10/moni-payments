import { describe, expect, it } from 'vitest';

import {
  EnvValidationError,
  assertSecretsConfig,
  loadEnv,
  type Env,
} from '../../../src/config/env';

const base = {
  NODE_ENV: 'development',
  PORT: '4000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://moniveo:moniveo@localhost:5433/moniveo_payments',
  SECRETS_PROVIDER: 'env',
} as const;

describe('loadEnv', () => {
  it('parses a valid environment and defaults APP_ENV from NODE_ENV', () => {
    const env = loadEnv({ ...base });

    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_URL).toContain('moniveo_payments');
    expect(env.APP_ENV).toBe('development');
    expect(env.SECRETS_CACHE_TTL_SECONDS).toBe(60);
    expect(env.SECRETS_DELETION_RECOVERY_WINDOW_DAYS).toBe(7);
    expect(env.CREDENTIALS_MAX_AGE_DAYS).toBe(90);
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

  it('requires APP_ENV when NODE_ENV=production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
      }),
    ).toThrow(/APP_ENV/);
  });

  it('accepts staging APP_ENV with aws secrets config', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      SECRETS_PROVIDER: 'aws',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'AKIATEST',
      AWS_SECRET_ACCESS_KEY: 'secret',
      SECRETS_NAMESPACE_PREFIX: 'moniveo-payments/staging/',
      SECRETS_KMS_KEY_ID: 'arn:aws:kms:us-east-1:123:key/abc',
    });
    expect(env.APP_ENV).toBe('staging');
    expect(env.SECRETS_PROVIDER).toBe('aws');
  });

  it('rejects staging/production without aws provider', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        SECRETS_PROVIDER: 'env',
      }),
    ).toThrow(/SECRETS_PROVIDER/);
  });

  it('rejects aws without required credentials', () => {
    expect(() =>
      loadEnv({
        ...base,
        SECRETS_PROVIDER: 'aws',
      }),
    ).toThrow(EnvValidationError);
  });

  it('rejects namespace prefix that does not match APP_ENV', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        APP_ENV: 'production',
        SECRETS_PROVIDER: 'aws',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIATEST',
        AWS_SECRET_ACCESS_KEY: 'secret',
        SECRETS_NAMESPACE_PREFIX: 'moniveo-payments/staging/',
        SECRETS_KMS_KEY_ID: 'key',
      }),
    ).toThrow(/SECRETS_NAMESPACE_PREFIX/);
  });
});

describe('assertSecretsConfig', () => {
  it('allows memory under development', () => {
    const env = {
      ...loadEnv({ ...base, SECRETS_PROVIDER: 'memory' }),
    } satisfies Env;
    expect(() => assertSecretsConfig(env)).not.toThrow();
  });
});
