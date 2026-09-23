import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  mapLegacyPaymentAccountStatus,
  migrateCredentialRefs,
} from '../../scripts/migrate-credential-refs';
import { EnvSecretsProvider } from '../../src/platform/secrets/env-provider';
import { MemorySecretsProvider } from '../../src/platform/secrets/memory-provider';
import { buildPaymentAccountSecretReference } from '../../src/platform/secrets/references';
import { createOrganizationFactory, createPaymentAccountFactory } from '../helpers/factories';
import { createTestPrisma } from '../helpers/db';

const CANARY_KEY = 'canary-migrate-api-key';
const CANARY_SECRET = 'canary-migrate-webhook-secret';

describe('migrate credential refs', () => {
  const prisma = createTestPrisma();
  const source = new EnvSecretsProvider({
    FAKE_PROVIDER_API_KEY: CANARY_KEY,
    FAKE_PROVIDER_WEBHOOK_SECRET: CANARY_SECRET,
  });
  const destination = new MemorySecretsProvider();
  let puts = 0;
  const countingDestination = Object.assign(destination, {
    put: async (reference: string, value: unknown) => {
      puts += 1;
      await MemorySecretsProvider.prototype.put.call(destination, reference, value);
    },
  });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('maps legacy statuses without taking an active account offline', () => {
    expect(mapLegacyPaymentAccountStatus('PENDING_CONFIGURATION')).toBe('NOT_CONFIGURED');
    expect(mapLegacyPaymentAccountStatus('ACTIVE')).toBe('ACTIVE');
    expect(mapLegacyPaymentAccountStatus('DISABLED')).toBe('DISABLED');
  });

  it('dry-run prints the plan and does not write, then a re-run skips migrated accounts', async () => {
    const org = await createOrganizationFactory(prisma, { externalId: `migrate-${Date.now()}` });
    const legacy = await createPaymentAccountFactory(prisma, org.id, {
      status: 'ACTIVE',
      isDefault: true,
      providerMerchantId: 'M-legacy',
    });
    const disabled = await createPaymentAccountFactory(prisma, org.id, {
      status: 'DISABLED',
      isDefault: false,
      providerMerchantId: 'M-disabled',
    });
    const already = await createPaymentAccountFactory(prisma, org.id, {
      status: 'ACTIVE',
      isDefault: false,
      providerMerchantId: 'M-done',
    });
    const doneRef = buildPaymentAccountSecretReference({
      appEnv: 'test',
      organizationId: org.id,
      paymentAccountId: already.id,
      scheme: 'memory',
    });
    await prisma.paymentAccount.update({
      where: { id: already.id },
      data: { secretRef: doneRef, credentialRefs: { bundle: doneRef } },
    });

    const lines: string[] = [];
    const preview = await migrateCredentialRefs({
      prisma,
      source,
      destination: countingDestination,
      appEnv: 'test',
      scheme: 'memory',
      dryRun: true,
      organizationId: org.id,
      log: (line) => lines.push(line),
    });

    expect(preview).toEqual({ migrated: 0, skipped: 1, planned: 2 });
    expect(puts).toBe(0);
    expect(lines.join('\n')).not.toContain(CANARY_KEY);
    expect(lines.join('\n')).not.toContain(CANARY_SECRET);
    const unchanged = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(unchanged.secretRef).toBeNull();

    const applied = await migrateCredentialRefs({
      prisma,
      source,
      destination: countingDestination,
      appEnv: 'test',
      scheme: 'memory',
      organizationId: org.id,
      log: () => undefined,
    });
    expect(applied.migrated).toBe(2);
    expect(puts).toBe(2);

    const migrated = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: legacy.id } });
    const expected = buildPaymentAccountSecretReference({
      appEnv: 'test',
      organizationId: org.id,
      paymentAccountId: legacy.id,
      scheme: 'memory',
    });
    expect(migrated.secretRef).toBe(expected);
    expect(migrated.status).toBe('ACTIVE');
    expect(migrated.credentialRefs).toEqual({ bundle: expected });
    await expect(destination.get(expected)).resolves.toEqual({
      apiKey: CANARY_KEY,
      webhookSecret: CANARY_SECRET,
    });

    const migratedDisabled = await prisma.paymentAccount.findUniqueOrThrow({
      where: { id: disabled.id },
    });
    expect(migratedDisabled.status).toBe('DISABLED');
    expect(migratedDisabled.secretRef).toContain('memory://');

    const again = await migrateCredentialRefs({
      prisma,
      source,
      destination: countingDestination,
      appEnv: 'test',
      scheme: 'memory',
      organizationId: org.id,
      log: () => undefined,
    });
    expect(again).toEqual({ migrated: 0, skipped: 3, planned: 0 });
    expect(puts).toBe(2);
  });
});
