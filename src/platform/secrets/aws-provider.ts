import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import { AppError, ErrorCode } from '../../domain/errors';
import { SecretValueCache } from './cache';
import {
  parseSecretReference,
  secretValueAsString,
  type SecretWriteOptions,
  type SecretsProvider,
} from './types';

const TRANSIENT_ERROR_NAMES = new Set([
  'ThrottlingException',
  'LimitExceededException',
  'InternalServiceError',
  'InternalServiceErrorException',
  'ServiceUnavailableException',
  'RequestTimeoutException',
  'TimeoutError',
  'NetworkingError',
]);

export interface SecretsManagerSendClient {
  send(command: unknown): Promise<unknown>;
}

export interface AwsSecretsManagerProviderOptions {
  namespacePrefix: string;
  kmsKeyId: string;
  /** Tag value written on create (staging | production | …). */
  environmentTag: string;
  recoveryWindowInDays: number;
  /** Capped at 60 seconds. */
  cacheTtlSeconds: number;
  region?: string;
  client?: SecretsManagerSendClient;
  now?: () => number;
}

/**
 * AWS Secrets Manager backend. Secret names are the reference locator and must sit under
 * `namespacePrefix`. Credential values are JSON `SecretString`s. Error messages never include
 * the secret payload or the raw AWS error text.
 */
export class AwsSecretsManagerProvider implements SecretsProvider {
  readonly schemes = ['awssm'] as const;

  private readonly client: SecretsManagerSendClient;
  private readonly cache: SecretValueCache;
  private readonly namespacePrefix: string;
  private readonly now: () => number;

  constructor(private readonly options: AwsSecretsManagerProviderOptions) {
    const ttlSeconds = Math.min(Math.max(options.cacheTtlSeconds, 1), 60);
    this.cache = new SecretValueCache(ttlSeconds * 1000);
    this.namespacePrefix = normalizePrefix(options.namespacePrefix);
    this.now = options.now ?? Date.now;
    if (options.client) {
      this.client = options.client;
    } else if (!options.region) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'AWS secrets configuration is incomplete.',
      );
    } else {
      this.client = new SecretsManagerClient({ region: options.region });
    }
  }

  async put<T>(reference: string, value: T, writeOptions?: SecretWriteOptions): Promise<void> {
    const name = this.requireName(reference);
    if (value === undefined) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Secret value must not be undefined.',
      );
    }
    const secretString = JSON.stringify(value);
    const token = writeOptions?.clientRequestToken;

    try {
      const described = await this.describe(name);
      if (described === 'missing') {
        await this.create(name, secretString, token);
      } else if (described === 'pending-deletion') {
        throw new AppError(
          ErrorCode.PROVIDER_CONFIGURATION_ERROR,
          'Secret is scheduled for deletion and cannot be written.',
        );
      } else {
        await this.putValue(name, secretString, token);
      }
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }
      if (errorName(error) === 'ResourceExistsException') {
        try {
          await this.putValue(name, secretString, token);
        } catch (putError) {
          throw mapAwsError(putError);
        }
      } else {
        throw mapAwsError(error);
      }
    }

    this.cache.invalidate(reference);
  }

  async get<T>(reference: string): Promise<T> {
    const cached = this.cache.get(reference, this.now());
    if (cached !== undefined) {
      return cached as T;
    }

    const name = this.requireName(reference);
    let secretString: string | undefined;
    try {
      const response = (await this.client.send(
        new GetSecretValueCommand({ SecretId: name }),
      )) as { SecretString?: string };
      secretString = response.SecretString;
    } catch (error) {
      throw mapAwsError(error);
    }

    if (typeof secretString !== 'string' || secretString.length === 0) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Secret payload is missing or empty.',
      );
    }

    let parsed: T;
    try {
      parsed = JSON.parse(secretString) as T;
    } catch {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Secret payload is not valid JSON.',
      );
    }

    this.cache.set(reference, parsed, this.now());
    return parsed;
  }

  /** True when get would return a value without calling Secrets Manager. */
  hasFreshCache(reference: string): boolean {
    return this.cache.get(reference, this.now()) !== undefined;
  }

  async delete(reference: string): Promise<void> {
    const name = this.requireName(reference);
    try {
      await this.client.send(
        new DeleteSecretCommand({
          SecretId: name,
          RecoveryWindowInDays: this.options.recoveryWindowInDays,
        }),
      );
    } catch (error) {
      if (errorName(error) === 'ResourceNotFoundException') {
        this.cache.invalidate(reference);
        return;
      }
      throw mapAwsError(error);
    }
    this.cache.invalidate(reference);
  }

  async exists(reference: string): Promise<boolean> {
    const name = this.requireName(reference);
    const described = await this.describe(name);
    return described === 'present';
  }

  /** @deprecated Prefer {@link AwsSecretsManagerProvider.get}. */
  async resolve(reference: string): Promise<string> {
    return secretValueAsString(await this.get<unknown>(reference));
  }

  private async describe(name: string): Promise<'missing' | 'pending-deletion' | 'present'> {
    try {
      const response = (await this.client.send(
        new DescribeSecretCommand({ SecretId: name }),
      )) as { DeletedDate?: Date };
      if (response.DeletedDate) {
        return 'pending-deletion';
      }
      return 'present';
    } catch (error) {
      if (errorName(error) === 'ResourceNotFoundException') {
        return 'missing';
      }
      throw mapAwsError(error);
    }
  }

  private async create(name: string, secretString: string, token: string | undefined): Promise<void> {
    await this.client.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: secretString,
        KmsKeyId: this.options.kmsKeyId,
        Tags: [{ Key: 'Environment', Value: this.options.environmentTag }],
        ...(token ? { ClientRequestToken: token } : {}),
      }),
    );
  }

  private async putValue(name: string, secretString: string, token: string | undefined): Promise<void> {
    await this.client.send(
      new PutSecretValueCommand({
        SecretId: name,
        SecretString: secretString,
        ...(token ? { ClientRequestToken: token } : {}),
      }),
    );
  }

  private requireName(reference: string): string {
    const parsed = parseSecretReference(reference);
    if (!parsed || parsed.scheme !== 'awssm') {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Invalid secret reference scheme.',
      );
    }
    if (!parsed.locator.startsWith(this.namespacePrefix)) {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Secret reference is outside the configured namespace.',
      );
    }
    return parsed.locator;
  }
}

function normalizePrefix(prefix: string): string {
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return '';
}

function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function mapAwsError(error: unknown): AppError {
  const name = errorName(error);
  if (TRANSIENT_ERROR_NAMES.has(name)) {
    return new AppError(
      ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE,
      'Secret store temporarily unavailable.',
    );
  }
  return new AppError(
    ErrorCode.PROVIDER_CONFIGURATION_ERROR,
    'Secret store request failed.',
  );
}
