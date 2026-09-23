import type { CredentialAuditOperation } from '@prisma/client';

import {
  paymentAccountSubjectFromReference,
  recordCredentialAudit,
  type CredentialAuditWrite,
} from '../audit/credential-audit';
import { secretValueAsString, type SecretsProvider, type SecretWriteOptions } from './types';

type CacheProbe = SecretsProvider & {
  hasFreshCache(reference: string): boolean;
};

function servesFreshCache(provider: SecretsProvider, reference: string): boolean {
  const probe = provider as Partial<CacheProbe>;
  return typeof probe.hasFreshCache === 'function' && probe.hasFreshCache(reference);
}

/**
 * Records credential operations for every backend. Cache hits are not reads of the
 * secret store and are not audited. Existence checks are recorded on every call.
 */
export class AuditingSecretsProvider implements SecretsProvider {
  readonly schemes: readonly string[];

  constructor(
    private readonly inner: SecretsProvider,
    private readonly record: (input: CredentialAuditWrite) => Promise<void> = recordCredentialAudit,
  ) {
    this.schemes = inner.schemes;
  }

  async put<T>(reference: string, value: T, options?: SecretWriteOptions): Promise<void> {
    const operation: CredentialAuditOperation =
      options?.auditOperation === 'rotation' ? 'ROTATION' : 'PUT';
    await this.audited(operation, reference, () => this.inner.put(reference, value, options));
  }

  async get<T>(reference: string): Promise<T> {
    if (servesFreshCache(this.inner, reference)) {
      return this.inner.get<T>(reference);
    }
    return this.audited('GET', reference, () => this.inner.get<T>(reference));
  }

  async delete(reference: string): Promise<void> {
    await this.audited('DELETE', reference, () => this.inner.delete(reference));
  }

  async exists(reference: string): Promise<boolean> {
    return this.audited('EXISTS', reference, () => this.inner.exists(reference));
  }

  /** @deprecated Prefer {@link AuditingSecretsProvider.get}. */
  async resolve(reference: string): Promise<string> {
    return secretValueAsString(await this.get<unknown>(reference));
  }

  private async audited<T>(
    operation: CredentialAuditOperation,
    reference: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const subject = paymentAccountSubjectFromReference(reference);
    try {
      const value = await run();
      if (subject) {
        await this.record({ ...subject, operation, outcome: 'SUCCESS' });
      }
      return value;
    } catch (error) {
      if (subject) {
        await this.record({ ...subject, operation, outcome: 'FAILURE' }).catch(() => undefined);
      }
      throw error;
    }
  }
}
