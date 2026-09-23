import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PrismaClient, type PaymentAccount, type PaymentAccountStatus } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';

import { loadAccountCredentialBundle } from '../src/modules/payment-accounts/credentials';
import { EnvSecretsProvider } from '../src/platform/secrets/env-provider';
import {
  buildPaymentAccountSecretReference,
  secretSchemeForProvider,
  type SecretScheme,
} from '../src/platform/secrets/references';
import { getSecretsProvider, type SecretsProvider } from '../src/platform/secrets';

loadDotenv({ path: resolve(process.cwd(), '.env') });

/**
 * Historical and current payment-account statuses.
 * ACTIVE stays ACTIVE so payments keep flowing during the migration.
 * PENDING_CONFIGURATION is the pre-T-008 name and is only mapped if it still appears.
 */
export const PAYMENT_ACCOUNT_STATUS_MIGRATION: Record<string, PaymentAccountStatus> = {
  PENDING_CONFIGURATION: 'NOT_CONFIGURED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  ONBOARDING: 'ONBOARDING',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
  REJECTED: 'REJECTED',
};

export function mapLegacyPaymentAccountStatus(status: string): PaymentAccountStatus {
  const mapped = PAYMENT_ACCOUNT_STATUS_MIGRATION[status];
  if (!mapped) {
    throw new Error(`No payment-account status mapping for ${status}.`);
  }
  return mapped;
}

export interface MigrateCredentialRefsOptions {
  prisma: PrismaClient;
  /** Reads legacy env:// field references. */
  source: SecretsProvider;
  /** Receives the service-generated bundle. */
  destination: SecretsProvider;
  appEnv: string;
  scheme: SecretScheme;
  dryRun?: boolean;
  organizationId?: string;
  log?: (line: string) => void;
}

export interface MigrateCredentialRefsResult {
  migrated: number;
  skipped: number;
  planned: number;
}

function targetReference(account: Pick<PaymentAccount, 'id' | 'organizationId'>, options: MigrateCredentialRefsOptions): string {
  return buildPaymentAccountSecretReference({
    appEnv: options.appEnv,
    organizationId: account.organizationId,
    paymentAccountId: account.id,
    scheme: options.scheme,
  });
}

function hasLegacyCredentials(account: PaymentAccount): boolean {
  if (account.secretRef) {
    return true;
  }
  const refs = account.credentialRefs;
  return !!refs && typeof refs === 'object' && !Array.isArray(refs) && Object.keys(refs).length > 0;
}

export async function migrateCredentialRefs(
  options: MigrateCredentialRefsOptions,
): Promise<MigrateCredentialRefsResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const dryRun = options.dryRun === true;
  const accounts = await options.prisma.paymentAccount.findMany({
    ...(options.organizationId ? { where: { organizationId: options.organizationId } } : {}),
    orderBy: { createdAt: 'asc' },
  });

  let migrated = 0;
  let skipped = 0;
  let planned = 0;

  for (const account of accounts) {
    const secretRef = targetReference(account, options);
    if (account.secretRef === secretRef) {
      skipped += 1;
      log(`skip paymentAccountId=${account.id} reason=already-migrated`);
      continue;
    }
    if (!hasLegacyCredentials(account)) {
      skipped += 1;
      log(`skip paymentAccountId=${account.id} reason=no-credentials`);
      continue;
    }

    const bundle = await loadAccountCredentialBundle(account, options.source);
    const keys = Object.keys(bundle).sort();
    const status = mapLegacyPaymentAccountStatus(account.status);
    log(
      `plan paymentAccountId=${account.id} secretRef=${secretRef} status ${account.status} -> ${status} keys=${keys.join(',')}`,
    );

    if (dryRun) {
      planned += 1;
      continue;
    }

    await options.destination.put(secretRef, bundle);
    await options.prisma.$transaction(async (tx) => {
      await tx.paymentAccount.update({
        where: { id: account.id },
        data: {
          secretRef,
          credentialRefs: { bundle: secretRef },
          credentialsPresentKeys: keys,
          credentialsUpdatedAt: new Date(),
          status,
        },
      });
    });
    migrated += 1;
  }

  log(`done migrated=${migrated} skipped=${skipped} planned=${planned} dryRun=${dryRun}`);
  return { migrated, skipped, planned };
}

function currentAppEnv(): string {
  if (process.env.APP_ENV) {
    return process.env.APP_ENV;
  }
  if (process.env.NODE_ENV === 'test') {
    return 'test';
  }
  if (process.env.NODE_ENV === 'production') {
    return 'production';
  }
  return 'development';
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const providerName = process.env.SECRETS_PROVIDER ?? 'env';
  if (providerName !== 'aws' && providerName !== 'memory' && providerName !== 'env') {
    throw new Error(`Unknown SECRETS_PROVIDER: ${providerName}`);
  }

  const prisma = new PrismaClient();
  try {
    const result = await migrateCredentialRefs({
      prisma,
      source: new EnvSecretsProvider(),
      destination: getSecretsProvider(),
      appEnv: currentAppEnv(),
      scheme: secretSchemeForProvider(providerName),
      dryRun,
    });
    if (!dryRun && result.migrated === 0 && result.skipped === 0) {
      console.log('No payment accounts found.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Migration failed.';
    console.error(message);
    process.exit(1);
  });
}
