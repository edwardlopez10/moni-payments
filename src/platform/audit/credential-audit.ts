import { AsyncLocalStorage } from 'node:async_hooks';

import type { CredentialAuditOperation, CredentialAuditOutcome } from '@prisma/client';

import { prisma } from '../../db/prisma';
import { parseSecretReference } from '../secrets/types';

export interface CredentialAuditActor {
  actorType: 'SERVICE_CLIENT' | 'OPERATOR' | 'SYSTEM';
  actorId: string;
  requestId: string | null;
}

const SYSTEM_ACTOR: CredentialAuditActor = {
  actorType: 'SYSTEM',
  actorId: 'system',
  requestId: null,
};

export const credentialAuditStorage = new AsyncLocalStorage<CredentialAuditActor>();

export function currentCredentialAuditActor(): CredentialAuditActor {
  return credentialAuditStorage.getStore() ?? SYSTEM_ACTOR;
}

export interface CredentialAuditSubject {
  organizationId: string;
  paymentAccountId: string;
}

/** Payment-account bundle locators only. Other references are not audited here. */
export function paymentAccountSubjectFromReference(
  reference: string,
): CredentialAuditSubject | null {
  const parsed = parseSecretReference(reference);
  if (!parsed) {
    return null;
  }
  const match =
    /^moniveo-payments\/[^/]+\/orgs\/([^/]+)\/payment-accounts\/([^/]+)$/.exec(parsed.locator);
  const organizationId = match?.[1];
  const paymentAccountId = match?.[2];
  if (!organizationId || !paymentAccountId) {
    return null;
  }
  return { organizationId, paymentAccountId };
}

export interface CredentialAuditWrite {
  organizationId: string;
  paymentAccountId: string;
  operation: CredentialAuditOperation;
  outcome: CredentialAuditOutcome;
}

/**
 * Insert-only. Callers must not update or delete these rows.
 * The stored columns never include a secret value.
 */
export async function recordCredentialAudit(input: CredentialAuditWrite): Promise<void> {
  const actor = currentCredentialAuditActor();
  await prisma.credentialAuditEvent.create({
    data: {
      organizationId: input.organizationId,
      paymentAccountId: input.paymentAccountId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      operation: input.operation,
      outcome: input.outcome,
      requestId: actor.requestId,
    },
  });
}
