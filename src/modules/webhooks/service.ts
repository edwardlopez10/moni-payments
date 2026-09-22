import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';

import { AppError, ErrorCode } from '../../domain/errors';
import { getSecretsProvider } from '../../platform/secrets';
import { ProviderCapability } from '../../providers/capabilities';
import { getProviderRegistry } from '../../providers/registry';
import type {
  NormalizedWebhookEvent,
  RawWebhookRequest,
  WebhookContext,
} from '../../providers/types';
import * as repo from './repository';
import type { WebhookAcceptedResponse } from './schema';

function headerRecord(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (Array.isArray(value) && value[0]) {
      result[key] = value[0];
    }
  }
  return result;
}

function signatureFromHeaders(headers: Record<string, string>): string | null {
  return headers['x-fake-signature'] ?? headers['x-signature'] ?? headers['stripe-signature'] ?? null;
}

async function buildWebhookContext(providerKey: string): Promise<WebhookContext> {
  const accounts = await repo.listCandidateAccounts(providerKey);
  const secrets = getSecretsProvider();
  const candidateAccounts = [];

  for (const account of accounts) {
    const refs =
      account.credentialRefs && typeof account.credentialRefs === 'object'
        ? (account.credentialRefs as Record<string, string>)
        : {};
    let signingSecret: string | undefined;
    if (typeof refs.webhookSecret === 'string') {
      try {
        signingSecret = await secrets.resolve(refs.webhookSecret);
      } catch {
        signingSecret = undefined;
      }
    }
    candidateAccounts.push({
      paymentAccountId: account.id,
      providerMerchantId: account.providerMerchantId,
      ...(signingSecret !== undefined ? { signingSecret } : {}),
    });
  }

  const primary = candidateAccounts.find((account) => account.signingSecret);
  return {
    provider: providerKey,
    ...(primary?.signingSecret !== undefined ? { signingSecret: primary.signingSecret } : {}),
    candidateAccounts,
  };
}

export async function ingestWebhook(input: {
  providerKey: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
}): Promise<WebhookAcceptedResponse> {
  const registry = getProviderRegistry();
  if (!registry.has(input.providerKey)) {
    throw new AppError(ErrorCode.PROVIDER_NOT_FOUND, `Provider '${input.providerKey}' not found.`);
  }

  const provider = registry.get(input.providerKey);
  if (!provider.capabilities.has(ProviderCapability.WEBHOOKS) || !provider.parseWebhook) {
    throw new AppError(ErrorCode.PROVIDER_NOT_FOUND, `Provider '${input.providerKey}' not found.`);
  }

  const rawRequest: RawWebhookRequest = {
    rawBody: input.rawBody,
    headers: input.headers,
    query: input.query,
  };

  let verified = false;
  if (
    provider.capabilities.has(ProviderCapability.WEBHOOK_SIGNATURE_VERIFICATION) &&
    provider.verifyWebhook
  ) {
    const ctx = await buildWebhookContext(input.providerKey);
    const result = await provider.verifyWebhook(rawRequest, ctx);
    if (!result.verified) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Webhook signature verification failed.');
    }
    verified = true;
  }

  let parsed: NormalizedWebhookEvent;
  try {
    parsed = await provider.parseWebhook(rawRequest);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Unparseable webhook body.');
  }

  const headers = headerRecord(input.headers);
  const rawBodyText = input.rawBody.toString('utf8');

  try {
    const created = await repo.insertWebhookEvent({
      provider: input.providerKey,
      providerEventId: parsed.providerEventId,
      eventType: parsed.providerEventType,
      payload: parsed as unknown as Prisma.InputJsonValue,
      rawBody: rawBodyText,
      headers,
      signature: signatureFromHeaders(headers),
      verified,
    });
    return { received: true, eventId: created.id, duplicate: false };
  } catch (error) {
    if (error instanceof PrismaNamespace.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await repo.findWebhookByProviderEvent(
        input.providerKey,
        parsed.providerEventId,
      );
      return {
        received: true,
        eventId: existing?.id ?? '00000000-0000-4000-8000-000000000000',
        duplicate: true,
      };
    }
    throw error;
  }
}
