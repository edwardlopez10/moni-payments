import { AppError, ErrorCode } from '../../domain/errors';
import { EnvSecretsProvider } from './env-provider';
import { parseSecretReference, type SecretsProvider } from './types';

const providersByName: Record<string, () => SecretsProvider> = {
  env: () => new EnvSecretsProvider(),
};

let cached: SecretsProvider | undefined;

export function createSecretsProvider(name: string = process.env.SECRETS_PROVIDER ?? 'env'): SecretsProvider {
  const factory = providersByName[name];
  if (!factory) {
    throw new AppError(
      ErrorCode.PROVIDER_CONFIGURATION_ERROR,
      `Unknown SECRETS_PROVIDER: ${name}`,
    );
  }
  return factory();
}

export function getSecretsProvider(): SecretsProvider {
  if (!cached) {
    cached = createSecretsProvider();
  }
  return cached;
}

/** Test helper to swap the singleton. */
export function setSecretsProviderForTests(provider: SecretsProvider | undefined): void {
  cached = provider;
}

export function acceptedSecretSchemes(provider: SecretsProvider = getSecretsProvider()): string[] {
  return [...provider.schemes];
}

export function assertValidSecretReference(
  reference: string,
  provider: SecretsProvider = getSecretsProvider(),
): void {
  const parsed = parseSecretReference(reference);
  const schemes = acceptedSecretSchemes(provider);
  if (!parsed || !schemes.includes(parsed.scheme)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Secret reference must use a registered scheme (${schemes.map((s) => `${s}://`).join(', ')}).`,
      {
        details: [
          {
            field: 'credentialRefs',
            issue: `expected one of: ${schemes.join(', ')}`,
          },
        ],
      },
    );
  }
}

export type { SecretsProvider } from './types';
export { parseSecretReference } from './types';
export { EnvSecretsProvider } from './env-provider';
