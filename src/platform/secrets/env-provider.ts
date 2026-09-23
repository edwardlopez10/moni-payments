import { AppError, ErrorCode } from '../../domain/errors';
import {
  parseSecretReference,
  secretValueAsString,
  type SecretsProvider,
} from './types';

/**
 * Environment-variable backed secrets.
 *
 * `put` / `delete` mutate the injected env bag (defaults to `process.env`). That is intentional
 * for local/dev and tests: the env backend is a mutable map, not a remote store. Staging and
 * production will refuse this provider once fail-fast boot (T-004) lands.
 */
export class EnvSecretsProvider implements SecretsProvider {
  readonly schemes = ['env'] as const;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async put<T>(reference: string, value: T): Promise<void> {
    const locator = this.requireLocator(reference);
    if (value === undefined) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Secret value must not be undefined.',
      );
    }
    this.env[locator] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  async get<T>(reference: string): Promise<T> {
    const locator = this.requireLocator(reference);
    const raw = this.env[locator];
    if (raw === undefined || raw === '') {
      // Do not include env contents or resolved values in the message.
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        `Secret reference could not be resolved (${locator}).`,
      );
    }
    return decodeEnvSecret<T>(raw);
  }

  async delete(reference: string): Promise<void> {
    const locator = this.requireLocator(reference);
    delete this.env[locator];
  }

  async exists(reference: string): Promise<boolean> {
    const locator = this.requireLocator(reference);
    const raw = this.env[locator];
    return raw !== undefined && raw !== '';
  }

  /** @deprecated Prefer {@link EnvSecretsProvider.get}. */
  async resolve(reference: string): Promise<string> {
    const value = await this.get<unknown>(reference);
    return secretValueAsString(value);
  }

  private requireLocator(reference: string): string {
    const parsed = parseSecretReference(reference);
    if (!parsed || parsed.scheme !== 'env') {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Invalid secret reference scheme.',
      );
    }
    return parsed.locator;
  }
}

function decodeEnvSecret<T>(raw: string): T {
  const trimmed = raw.trim();
  if (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    /^-?\d+(?:\.\d+)?$/.test(trimmed)
  ) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Fall through: treat as a plain string secret.
    }
  }
  return raw as T;
}
