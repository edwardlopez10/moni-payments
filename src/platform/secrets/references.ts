import { AppError, ErrorCode } from '../../domain/errors';
import { parseSecretReference } from './types';

/**
 * Persisted shape (applied when payment-account writes land in T-008/T-009):
 * `credentialRefs` holds only a service-generated bundle reference, never values:
 * `{ bundle: "<scheme>://moniveo-payments/<env>/orgs/<orgId>/payment-accounts/<accountId>" }`.
 * API responses continue to expose credential field names, not the reference or the values.
 */
export type SecretScheme = 'awssm' | 'memory' | 'env';

export function secretSchemeForProvider(provider: 'aws' | 'memory' | 'env'): SecretScheme {
  if (provider === 'aws') {
    return 'awssm';
  }
  return provider;
}

export function buildPaymentAccountSecretLocator(input: {
  appEnv: string;
  organizationId: string;
  paymentAccountId: string;
}): string {
  return `moniveo-payments/${input.appEnv}/orgs/${input.organizationId}/payment-accounts/${input.paymentAccountId}`;
}

export function buildPaymentAccountSecretReference(input: {
  appEnv: string;
  organizationId: string;
  paymentAccountId: string;
  scheme: SecretScheme;
}): string {
  return `${input.scheme}://${buildPaymentAccountSecretLocator(input)}`;
}

export function assertSecretInNamespace(reference: string, namespacePrefix: string): void {
  const parsed = parseSecretReference(reference);
  const prefix = namespacePrefix.endsWith('/') ? namespacePrefix : `${namespacePrefix}/`;
  if (!parsed || !parsed.locator.startsWith(prefix)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Secret reference is outside the configured namespace.', {
      details: [{ field: 'secretRef', issue: 'outside namespace' }],
    });
  }
}
