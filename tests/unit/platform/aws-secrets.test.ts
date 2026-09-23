import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { describe, expect, it, vi } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import { AwsSecretsManagerProvider } from '../../../src/platform/secrets/aws-provider';
import {
  assertValidSecretReference,
  buildPaymentAccountSecretReference,
  createSecretsProvider,
  secretSchemeForProvider,
} from '../../../src/platform/secrets';

const PREFIX = 'moniveo-payments/staging/';
const REF = `awssm://${PREFIX}orgs/org-1/payment-accounts/acct-1`;
const CANARY = 'canary-secret-do-not-leak';

function namedError(name: string, message = `aws said ${CANARY}`): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function provider(send: (command: unknown) => Promise<unknown>, now = () => 1_000_000) {
  return new AwsSecretsManagerProvider({
    namespacePrefix: PREFIX,
    kmsKeyId: 'kms-staging',
    environmentTag: 'staging',
    recoveryWindowInDays: 7,
    cacheTtlSeconds: 60,
    client: { send },
    now,
  });
}

describe('AwsSecretsManagerProvider', () => {
  it('creates a secret with the customer key, environment tag, and client token', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof DescribeSecretCommand) {
        throw namedError('ResourceNotFoundException');
      }
      return {};
    });
    const secrets = provider(send);
    await secrets.put(REF, { clientSecret: CANARY }, { clientRequestToken: 'idem-1' });

    const create = send.mock.calls.map((call) => call[0]).find((command) => command instanceof CreateSecretCommand);
    expect(create).toBeInstanceOf(CreateSecretCommand);
    const input = (create as CreateSecretCommand).input;
    expect(input.Name).toBe(`${PREFIX}orgs/org-1/payment-accounts/acct-1`);
    expect(input.KmsKeyId).toBe('kms-staging');
    expect(input.ClientRequestToken).toBe('idem-1');
    expect(input.Tags).toEqual([{ Key: 'Environment', Value: 'staging' }]);
    expect(input.SecretString).toBe(JSON.stringify({ clientSecret: CANARY }));
  });

  it('writes a new version when the secret already exists', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof DescribeSecretCommand) {
        return {};
      }
      return {};
    });
    await provider(send).put(REF, { clientSecret: CANARY });
    const put = send.mock.calls.map((call) => call[0]).find((command) => command instanceof PutSecretValueCommand);
    expect(put).toBeInstanceOf(PutSecretValueCommand);
    expect(send.mock.calls.some((call) => call[0] instanceof CreateSecretCommand)).toBe(false);
  });

  it('deletes with a recovery window and never force-deletes', async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    await provider(send).delete(REF);
    const command = send.mock.calls[0]?.[0] as DeleteSecretCommand | undefined;
    expect(command).toBeInstanceOf(DeleteSecretCommand);
    expect(command?.input.RecoveryWindowInDays).toBe(7);
    expect(command?.input.ForceDeleteWithoutRecovery).toBeUndefined();
  });

  it('treats a secret pending deletion as absent', async () => {
    const send = vi.fn(async () => ({ DeletedDate: new Date() }));
    await expect(provider(send).exists(REF)).resolves.toBe(false);
  });

  it('serves cached values only inside the TTL and invalidates on write', async () => {
    let now = 1_000_000;
    let reads = 0;
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetSecretValueCommand) {
        reads += 1;
        return { SecretString: JSON.stringify({ clientSecret: CANARY }) };
      }
      if (command instanceof DescribeSecretCommand) {
        return {};
      }
      return {};
    });
    const secrets = provider(send, () => now);

    await expect(secrets.get(REF)).resolves.toEqual({ clientSecret: CANARY });
    await expect(secrets.get(REF)).resolves.toEqual({ clientSecret: CANARY });
    expect(reads).toBe(1);

    now += 60_001;
    await secrets.get(REF);
    expect(reads).toBe(2);

    await secrets.put(REF, { clientSecret: 'next' });
    await secrets.get(REF);
    expect(reads).toBe(3);
  });

  it('does not serve an expired cache entry when AWS is unavailable', async () => {
    let now = 1_000_000;
    let first = true;
    const send = vi.fn(async () => {
      if (first) {
        first = false;
        return { SecretString: JSON.stringify({ clientSecret: CANARY }) };
      }
      throw namedError('ThrottlingException');
    });
    const secrets = provider(send, () => now);
    await secrets.get(REF);
    now += 60_001;
    await expect(secrets.get(REF)).rejects.toMatchObject({
      code: ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE,
    });
  });

  it('maps throttling to unavailable and access-denied to configuration error without leaking values', async () => {
    const throttled = provider(vi.fn(async () => {
      throw namedError('ThrottlingException');
    }));
    await expect(throttled.get(REF)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.PROVIDER_CONFIGURATION_UNAVAILABLE);
      expect((error as AppError).message).not.toContain(CANARY);
      return true;
    });

    const denied = provider(vi.fn(async () => {
      throw namedError('AccessDeniedException');
    }));
    await expect(denied.get(REF)).rejects.toMatchObject({
      code: ErrorCode.PROVIDER_CONFIGURATION_ERROR,
    });
  });

  it('rejects malformed JSON and references outside the namespace', async () => {
    const send = vi.fn(async () => ({ SecretString: 'not-json' }));
    await expect(provider(send).get(REF)).rejects.toMatchObject({
      code: ErrorCode.PROVIDER_CONFIGURATION_ERROR,
    });

    const guarded = vi.fn();
    await expect(
      provider(guarded).get('awssm://moniveo-payments/production/orgs/org-1/payment-accounts/acct-1'),
    ).rejects.toMatchObject({ code: ErrorCode.PROVIDER_CONFIGURATION_ERROR });
    expect(guarded).not.toHaveBeenCalled();
  });
});

describe('AWS provider registration', () => {
  it('registers SECRETS_PROVIDER=aws when configuration is present', () => {
    const previous = {
      AWS_REGION: process.env.AWS_REGION,
      SECRETS_NAMESPACE_PREFIX: process.env.SECRETS_NAMESPACE_PREFIX,
      SECRETS_KMS_KEY_ID: process.env.SECRETS_KMS_KEY_ID,
      APP_ENV: process.env.APP_ENV,
    };
    process.env.AWS_REGION = 'us-east-1';
    process.env.SECRETS_NAMESPACE_PREFIX = PREFIX;
    process.env.SECRETS_KMS_KEY_ID = 'kms-staging';
    process.env.APP_ENV = 'staging';
    try {
      expect(createSecretsProvider('aws').schemes).toEqual(['awssm']);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

describe('payment account secret references', () => {
  it('builds a namespaced reference with the active scheme', () => {
    expect(secretSchemeForProvider('aws')).toBe('awssm');
    expect(
      buildPaymentAccountSecretReference({
        scheme: 'awssm',
        appEnv: 'staging',
        organizationId: 'org-1',
        paymentAccountId: 'acct-1',
      }),
    ).toBe('awssm://moniveo-payments/staging/orgs/org-1/payment-accounts/acct-1');
  });

  it('rejects a reference outside the running namespace', () => {
    const aws = createSecretsProvider('memory');
    expect(() =>
      assertValidSecretReference(
        'memory://moniveo-payments/production/orgs/org-1/payment-accounts/acct-1',
        aws,
        { namespacePrefix: 'moniveo-payments/staging/' },
      ),
    ).toThrow(AppError);
  });
});
