import { AppError, ErrorCode } from '../../domain/errors';
import {
  parseSecretReference,
  secretValueAsString,
  type SecretsProvider,
} from './types';

/**
 * Process-local secrets store for development and automated tests.
 * Values never leave the process heap and are never logged by this provider.
 */
export class MemorySecretsProvider implements SecretsProvider {
  readonly schemes = ['memory'] as const;

  private readonly store = new Map<string, unknown>();

  async put<T>(reference: string, value: T): Promise<void> {
    const locator = this.requireLocator(reference);
    if (value === undefined) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Secret value must not be undefined.',
      );
    }
    this.store.set(locator, value);
  }

  async get<T>(reference: string): Promise<T> {
    const locator = this.requireLocator(reference);
    if (!this.store.has(locator)) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        `Secret reference could not be resolved (${locator}).`,
      );
    }
    return this.store.get(locator) as T;
  }

  async delete(reference: string): Promise<void> {
    const locator = this.requireLocator(reference);
    this.store.delete(locator);
  }

  async exists(reference: string): Promise<boolean> {
    const locator = this.requireLocator(reference);
    return this.store.has(locator);
  }

  /** @deprecated Prefer {@link MemorySecretsProvider.get}. */
  async resolve(reference: string): Promise<string> {
    const value = await this.get<unknown>(reference);
    return secretValueAsString(value);
  }

  /** Test helper: drop all stored secrets. */
  clear(): void {
    this.store.clear();
  }

  private requireLocator(reference: string): string {
    const parsed = parseSecretReference(reference);
    if (!parsed || parsed.scheme !== 'memory') {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Invalid secret reference scheme.',
      );
    }
    return parsed.locator;
  }
}
