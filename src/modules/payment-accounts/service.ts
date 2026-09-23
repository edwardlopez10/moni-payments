import type { PaymentAccount, PaymentAccountStatus, Prisma } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import { recordCredentialAudit } from '../../platform/audit/credential-audit';
import type { ServiceContext } from '../../platform/auth/service-auth';
import {
  buildPaymentAccountSecretReference,
  getSecretsProvider,
  secretSchemeForProvider,
  type SecretScheme,
} from '../../platform/secrets';
import { resolveOrganization } from '../organizations/scope';
import { assertProviderCredentials } from './credential-schema';
import { loadAccountCredentialBundle } from './credentials';
import { assertPaymentAccountTransition, isTerminalPaymentAccountStatus } from './lifecycle';
import { toPaymentAccountResponse } from './mapper';
import * as repo from './repository';
import type {
  CreatePaymentAccountBody,
  PatchPaymentAccountBody,
  PaymentAccountResponse,
  RotatePaymentAccountCredentialsBody,
} from './schema';

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

function currentSecretScheme(): SecretScheme {
  const provider = process.env.SECRETS_PROVIDER ?? (process.env.NODE_ENV === 'test' ? 'memory' : 'env');
  if (provider === 'aws' || provider === 'memory' || provider === 'env') {
    return secretSchemeForProvider(provider);
  }
  return 'env';
}

function referenceFor(organizationId: string, paymentAccountId: string): string {
  return buildPaymentAccountSecretReference({
    appEnv: currentAppEnv(),
    organizationId,
    paymentAccountId,
    scheme: currentSecretScheme(),
  });
}

async function assertReadyForVerification(account: PaymentAccount): Promise<void> {
  if (!account.secretRef) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Credentials must be stored before verification.', {
      details: [{ field: 'credentials', issue: 'missing' }],
    });
  }
  const secrets = getSecretsProvider();
  if (!(await secrets.exists(account.secretRef))) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Credentials must be stored before verification.', {
      details: [{ field: 'credentials', issue: 'not found' }],
    });
  }
  const bundle = await loadAccountCredentialBundle(account, secrets);
  assertProviderCredentials(account.provider, bundle);
}

export async function createPaymentAccount(
  organizationId: string,
  body: CreatePaymentAccountBody,
  service: ServiceContext,
): Promise<PaymentAccountResponse> {
  await resolveOrganization(organizationId, service.sourceProduct, 'mutate');

  const credentials = body.credentials ?? {};
  const hasCredentials = Object.keys(credentials).length > 0;
  if (hasCredentials) {
    assertProviderCredentials(body.provider, credentials);
  }

  const created = await repo.withTransaction(async (tx) => {
    if (body.isDefault) {
      await repo.clearDefaultFlags(organizationId, undefined, tx);
    }
    return repo.createPaymentAccountRow(
      {
        organizationId,
        provider: body.provider,
        providerMerchantId: body.providerMerchantId,
        status: 'NOT_CONFIGURED',
        isDefault: body.isDefault,
        configuration: body.configuration as Prisma.InputJsonValue,
        credentialRefs: {},
      },
      tx,
    );
  });

  if (!hasCredentials) {
    return toPaymentAccountResponse(created);
  }

  const reference = referenceFor(organizationId, created.id);
  await getSecretsProvider().put(reference, credentials);
  assertPaymentAccountTransition('NOT_CONFIGURED', 'ONBOARDING');

  const updated = await repo.updatePaymentAccountRow(created.id, {
    status: 'ONBOARDING',
    secretRef: reference,
    credentialRefs: { bundle: reference },
    credentialsPresentKeys: Object.keys(credentials).sort(),
    credentialsUpdatedAt: new Date(),
  });
  await recordCredentialAudit({
    organizationId,
    paymentAccountId: created.id,
    operation: 'LIFECYCLE',
    outcome: 'SUCCESS',
  });
  return toPaymentAccountResponse(updated);
}

export async function listPaymentAccounts(
  organizationId: string,
  service: ServiceContext,
): Promise<{ data: PaymentAccountResponse[] }> {
  await resolveOrganization(organizationId, service.sourceProduct, 'read');
  const rows = await repo.listPaymentAccounts(organizationId);
  return { data: rows.map(toPaymentAccountResponse) };
}

export async function patchPaymentAccount(
  organizationId: string,
  accountId: string,
  body: PatchPaymentAccountBody,
  service: ServiceContext,
): Promise<PaymentAccountResponse> {
  await resolveOrganization(organizationId, service.sourceProduct, 'mutate');
  const existing = await repo.findPaymentAccountById(accountId);
  if (!existing || existing.organizationId !== organizationId) {
    throw new AppError(ErrorCode.PROVIDER_CONFIGURATION_ERROR, 'Payment account not found.', {
      details: [{ field: 'accountId', issue: 'not found for organization' }],
    });
  }

  let secretRef = existing.secretRef;
  let presentKeys = existing.credentialsPresentKeys;
  let credentialsUpdatedAt = existing.credentialsUpdatedAt;
  let credentialRefs = existing.credentialRefs;

  if (body.credentials && Object.keys(body.credentials).length > 0) {
    assertProviderCredentials(existing.provider, body.credentials);
    secretRef = secretRef ?? referenceFor(organizationId, existing.id);
    await getSecretsProvider().put(secretRef, body.credentials);
    presentKeys = Object.keys(body.credentials).sort();
    credentialsUpdatedAt = new Date();
    credentialRefs = { bundle: secretRef };
  }

  const status: PaymentAccountStatus | undefined = body.status;
  if (status !== undefined) {
    assertPaymentAccountTransition(existing.status, status);
  }

  const preview: PaymentAccount = {
    ...existing,
    secretRef,
    credentialRefs: credentialRefs as Prisma.JsonValue,
  };
  if (status === 'PENDING_VERIFICATION') {
    await assertReadyForVerification(preview);
  }

  if ((status === 'DISABLED' || status === 'REJECTED') && secretRef) {
    await getSecretsProvider().delete(secretRef);
  }

  const row = await repo.withTransaction(async (tx) => {
    if (body.isDefault === true) {
      await repo.clearDefaultFlags(organizationId, accountId, tx);
    }
    return repo.updatePaymentAccountRow(
      accountId,
      {
        ...(status !== undefined ? { status } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.configuration !== undefined
          ? { configuration: body.configuration as Prisma.InputJsonValue }
          : {}),
        ...(body.credentials !== undefined
          ? {
              secretRef,
              credentialRefs: credentialRefs as Prisma.InputJsonValue,
              credentialsPresentKeys: presentKeys as Prisma.InputJsonValue,
              credentialsUpdatedAt,
            }
          : {}),
      },
      tx,
    );
  });

  if (status !== undefined && status !== existing.status) {
    await recordCredentialAudit({
      organizationId,
      paymentAccountId: accountId,
      operation: 'LIFECYCLE',
      outcome: 'SUCCESS',
    });
  }

  return toPaymentAccountResponse(row);
}

export async function rotatePaymentAccountCredentials(
  organizationId: string,
  accountId: string,
  body: RotatePaymentAccountCredentialsBody,
  service: ServiceContext,
): Promise<PaymentAccountResponse> {
  await resolveOrganization(organizationId, service.sourceProduct, 'mutate');
  const existing = await repo.findPaymentAccountById(accountId);
  if (!existing || existing.organizationId !== organizationId) {
    throw new AppError(ErrorCode.PROVIDER_CONFIGURATION_ERROR, 'Payment account not found.', {
      details: [{ field: 'accountId', issue: 'not found for organization' }],
    });
  }
  if (isTerminalPaymentAccountStatus(existing.status)) {
    throw new AppError(
      ErrorCode.INVALID_PAYMENT_STATE,
      'Cannot rotate credentials for a terminal payment account.',
    );
  }

  assertProviderCredentials(existing.provider, body.credentials);
  const secretRef = existing.secretRef ?? referenceFor(organizationId, existing.id);
  await getSecretsProvider().put(secretRef, body.credentials, { auditOperation: 'rotation' });

  const row = await repo.updatePaymentAccountRow(accountId, {
    secretRef,
    credentialRefs: { bundle: secretRef },
    credentialsPresentKeys: Object.keys(body.credentials).sort(),
    credentialsUpdatedAt: new Date(),
  });
  return toPaymentAccountResponse(row);
}
