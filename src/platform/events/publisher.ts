import type { EventSubscription, OutboxEvent, SourceProduct } from '@prisma/client';

import { prisma } from '../../db/prisma';
import { AppError, ErrorCode } from '../../domain/errors';
import { getSecretsProvider } from '../secrets';
import { signCallbackBody } from './signing';

export interface EventPublisher {
  deliver(event: OutboxEvent): Promise<void>;
}

export async function resolveEventSubscription(input: {
  sourceProduct: SourceProduct;
  organizationId: string;
  eventType: string;
}): Promise<EventSubscription | null> {
  const candidates = await prisma.eventSubscription.findMany({
    where: {
      sourceProduct: input.sourceProduct,
      active: true,
      OR: [{ organizationId: input.organizationId }, { organizationId: null }],
    },
    orderBy: { organizationId: 'desc' }, // non-null (org-scoped) sorts after null in desc? 
  });

  // Prefer organization-scoped over product-wide.
  const ordered = [
    ...candidates.filter((row) => row.organizationId === input.organizationId),
    ...candidates.filter((row) => row.organizationId == null),
  ];

  for (const sub of ordered) {
    if (sub.eventTypes.length === 0 || sub.eventTypes.includes(input.eventType)) {
      return sub;
    }
  }
  return null;
}

export class HttpEventPublisher implements EventPublisher {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly resolveSecret: (ref: string) => Promise<string> = async (ref) => {
      const value = await getSecretsProvider().get<unknown>(ref);
      if (typeof value !== 'string' || value.length === 0) {
        throw new AppError(
          ErrorCode.PROVIDER_CONFIGURATION_ERROR,
          'Callback secret is missing or malformed.',
        );
      }
      return value;
    },
  ) {}

  async deliver(event: OutboxEvent): Promise<void> {
    const subscription =
      (event.subscriptionId
        ? await prisma.eventSubscription.findUnique({ where: { id: event.subscriptionId } })
        : null) ??
      (await resolveEventSubscription({
        sourceProduct: event.sourceProduct,
        organizationId: event.organizationId,
        eventType: event.eventType,
      }));

    if (!subscription) {
      throw new Error(`No active event subscription for ${event.eventType}`);
    }

    const secret = await this.resolveSecret(subscription.secretRef);
    const rawBody = JSON.stringify(event.payload);
    const attempt = event.attempts + 1;
    const response = await this.fetchImpl(subscription.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Moniveo-Event-Id': event.eventId,
        'X-Moniveo-Signature': signCallbackBody(rawBody, secret),
        'X-Moniveo-Delivery-Attempt': String(attempt),
      },
      body: rawBody,
    });

    if (response.status < 200 || response.status >= 300) {
      const text = await response.text().catch(() => '');
      throw new Error(`Callback returned ${response.status}: ${text.slice(0, 200)}`);
    }
  }
}

let publisher: EventPublisher = new HttpEventPublisher();

export function getEventPublisher(): EventPublisher {
  return publisher;
}

export function setEventPublisherForTests(next: EventPublisher | undefined): void {
  publisher = next ?? new HttpEventPublisher();
}
