import { AppError, ErrorCode } from '../../domain/errors';
import { AuditingSecretsProvider } from './auditing-provider';
import { AwsSecretsManagerProvider } from './aws-provider';
import { EnvSecretsProvider } from './env-provider';
import { MemorySecretsProvider } from './memory-provider';
import { assertSecretInNamespace } from './references';
import {
  parseSecretReference,
  secretValueAsString,
  type SecretsProvider,
} from './types';

function createAwsProvider(): SecretsProvider {
  const region = process.env.AWS_REGION;
  const namespacePrefix = process.env.SECRETS_NAMESPACE_PREFIX;
  const kmsKeyId = process.env.SECRETS_KMS_KEY_ID;
  if (!region || !namespacePrefix || !kmsKeyId) {
    throw new AppError(
      ErrorCode.PROVIDER_CONFIGURATION_ERROR,
      'AWS secrets configuration is incomplete.',
    );
  }
  const ttl = Number(process.env.SECRETS_CACHE_TTL_SECONDS ?? 60);
  const recovery = Number(process.env.SECRETS_DELETION_RECOVERY_WINDOW_DAYS ?? 7);
  return new AwsSecretsManagerProvider({
    region,
    namespacePrefix,
    kmsKeyId,
    environmentTag: process.env.APP_ENV ?? 'development',
    cacheTtlSeconds: Number.isFinite(ttl) ? ttl : 60,
    recoveryWindowInDays: Number.isFinite(recovery) ? recovery : 7,
  });
}

const providersByName: Record<string, () => SecretsProvider> = {
  env: () => new EnvSecretsProvider(),
  memory: () => new MemorySecretsProvider(),
  aws: () => createAwsProvider(),
};

let cached: SecretsProvider | undefined;

function defaultSecretsProviderName(): string {
  if (process.env.SECRETS_PROVIDER) {
    return process.env.SECRETS_PROVIDER;
  }
  return process.env.NODE_ENV === 'test' ? 'memory' : 'env';
}

export function createSecretsProvider(
  name: string = defaultSecretsProviderName(),
): SecretsProvider {
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
    cached = new AuditingSecretsProvider(createSecretsProvider());
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
  options?: { namespacePrefix?: string },
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
  if (options?.namespacePrefix) {
    assertSecretInNamespace(reference, options.namespacePrefix);
  }
}

/**
 * @deprecated Prefer `provider.get()`. Temporary bridge until callers migrate (spec T-010).
 */
export async function resolveSecret(
  reference: string,
  provider: SecretsProvider = getSecretsProvider(),
): Promise<string> {
  const value = await provider.get<unknown>(reference);
  return secretValueAsString(value);
}

export type { SecretsProvider } from './types';
export { parseSecretReference, secretValueAsString } from './types';
export { EnvSecretsProvider } from './env-provider';
export { MemorySecretsProvider } from './memory-provider';
export { AwsSecretsManagerProvider } from './aws-provider';
export { AuditingSecretsProvider } from './auditing-provider';
export {
  assertSecretInNamespace,
  buildPaymentAccountSecretLocator,
  buildPaymentAccountSecretReference,
  secretSchemeForProvider,
} from './references';
export type { SecretScheme } from './references';
