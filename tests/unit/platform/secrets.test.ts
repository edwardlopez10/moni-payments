import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import {
  EnvSecretsProvider,
  acceptedSecretSchemes,
  assertValidSecretReference,
  createSecretsProvider,
} from '../../../src/platform/secrets';

describe('secrets provider', () => {
  it('resolves env://NAME from the environment', async () => {
    const provider = new EnvSecretsProvider({ MY_SECRET: 'super-secret-value' });
    await expect(provider.resolve('env://MY_SECRET')).resolves.toBe('super-secret-value');
  });

  it('throws PROVIDER_CONFIGURATION_ERROR without leaking values', async () => {
    const provider = new EnvSecretsProvider({ MY_SECRET: 'super-secret-value' });
    await expect(provider.resolve('env://MISSING')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe(ErrorCode.PROVIDER_CONFIGURATION_ERROR);
      expect(appError.message).not.toContain('super-secret-value');
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
});
