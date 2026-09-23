import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import {
  EnvSecretsProvider,
  MemorySecretsProvider,
  acceptedSecretSchemes,
  assertValidSecretReference,
  createSecretsProvider,
  getSecretsProvider,
  resolveSecret,
  setSecretsProviderForTests,
} from '../../../src/platform/secrets';

describe('secrets provider', () => {
  it('get/put/delete/exists round-trip on env://NAME', async () => {
    const env: NodeJS.ProcessEnv = {};
    const provider = new EnvSecretsProvider(env);

    await expect(provider.exists('env://MY_SECRET')).resolves.toBe(false);
    await provider.put('env://MY_SECRET', 'super-secret-value');
    await expect(provider.exists('env://MY_SECRET')).resolves.toBe(true);
    await expect(provider.get<string>('env://MY_SECRET')).resolves.toBe('super-secret-value');
    await expect(provider.resolve('env://MY_SECRET')).resolves.toBe('super-secret-value');

    await provider.put('env://MY_SECRET', { clientId: 'id', clientSecret: 'sekrit' });
    await expect(provider.get<{ clientId: string; clientSecret: string }>('env://MY_SECRET')).resolves.toEqual({
      clientId: 'id',
      clientSecret: 'sekrit',
    });

    await provider.delete('env://MY_SECRET');
    await expect(provider.exists('env://MY_SECRET')).resolves.toBe(false);
  });

  it('throws PROVIDER_CONFIGURATION_ERROR without leaking values', async () => {
    const provider = new EnvSecretsProvider({ MY_SECRET: 'super-secret-value' });
    await expect(provider.get('env://MISSING')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe(ErrorCode.PROVIDER_CONFIGURATION_ERROR);
      expect(appError.message).not.toContain('super-secret-value');
      return true;
    });
  });

  it('resolveSecret bridge stringifies non-string values without leaking via errors', async () => {
    const provider = new EnvSecretsProvider({});
    await provider.put('env://BUNDLE', { token: 'should-not-leak-on-error' });
    await expect(resolveSecret('env://BUNDLE', provider)).resolves.toBe(
      JSON.stringify({ token: 'should-not-leak-on-error' }),
    );
    await expect(resolveSecret('env://GONE', provider)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).not.toContain('should-not-leak-on-error');
      return true;
    });
  });

  it('derives accepted schemes from registered implementations', () => {
    const provider = createSecretsProvider('env');
    expect(acceptedSecretSchemes(provider)).toEqual(['env']);
    expect(() => assertValidSecretReference('env://FOO', provider)).not.toThrow();
    expect(() => assertValidSecretReference('awssm://path', provider)).toThrow(AppError);
    expect(() => assertValidSecretReference('plaintext-secret', provider)).toThrow(AppError);
  });

  it('registers memory provider and accepts memory:// schemes', () => {
    const provider = createSecretsProvider('memory');
    expect(acceptedSecretSchemes(provider)).toEqual(['memory']);
    expect(() => assertValidSecretReference('memory://org/acct', provider)).not.toThrow();
    expect(() => assertValidSecretReference('env://FOO', provider)).toThrow(AppError);
  });
});

describe('MemorySecretsProvider', () => {
  it('round-trips put/get/delete/exists without env vars', async () => {
    const provider = new MemorySecretsProvider();
    const ref = 'memory://orgs/o1/payment-accounts/a1';
    const canary = 'memory-canary-secret-value';

    await expect(provider.exists(ref)).resolves.toBe(false);
    await provider.put(ref, { apiKey: canary });
    await expect(provider.exists(ref)).resolves.toBe(true);
    await expect(provider.get<{ apiKey: string }>(ref)).resolves.toEqual({ apiKey: canary });
    await expect(provider.resolve(ref)).resolves.toBe(JSON.stringify({ apiKey: canary }));

    await provider.delete(ref);
    await expect(provider.exists(ref)).resolves.toBe(false);
    await expect(provider.get(ref)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.PROVIDER_CONFIGURATION_ERROR);
      expect((error as AppError).message).not.toContain(canary);
      return true;
    });
  });

  it('installs via setSecretsProviderForTests', async () => {
    const provider = new MemorySecretsProvider();
    setSecretsProviderForTests(provider);
    try {
      await provider.put('memory://test', 'installed');
      await expect(getSecretsProvider().get<string>('memory://test')).resolves.toBe('installed');
    } finally {
      setSecretsProviderForTests(undefined);
    }
  });
});
