import type { OutboxEvent } from '@prisma/client';

import { nextAttemptDelayMs } from '../../domain/events';
import { prisma } from '../../db/prisma';
import { processWebhookEvent } from '../../modules/webhooks/processor';
import { listDueWebhookEvents } from '../../modules/webhooks/repository';
import { getEventPublisher } from './publisher';

export interface DispatcherOptions {
  /** Milliseconds between ticks. `0` or negative disables the interval (manual ticks only). */
  intervalMs: number;
  batchSize?: number;
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

async function claimOutboxEvent(id: string): Promise<OutboxEvent | null> {
  const updated = await prisma.$executeRaw`
    UPDATE outbox_events
    SET status = 'DELIVERING'
    WHERE id = ${id}
      AND status IN ('PENDING', 'FAILED')
      AND next_attempt_at <= NOW()
  `;
  if (updated === 0) {
    return null;
  }
  return prisma.outboxEvent.findUnique({ where: { id } });
}

async function listDueOutboxEvents(limit: number): Promise<OutboxEvent[]> {
  return prisma.outboxEvent.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });
}

export class EventDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly batchSize: number;
  private readonly logger: NonNullable<DispatcherOptions['logger']>;

  constructor(private readonly options: DispatcherOptions) {
    this.batchSize = options.batchSize ?? 20;
    this.logger = options.logger ?? {
      info: () => undefined,
      error: () => undefined,
      warn: () => undefined,
    };
  }

  start(): void {
    if (this.options.intervalMs <= 0) {
      return;
    }
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);
    this.timer.unref?.();
    this.logger.info({ intervalMs: this.options.intervalMs }, 'Event dispatcher started');
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait for in-flight tick to finish.
    const deadline = Date.now() + 10_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.logger.info('Event dispatcher stopped');
  }

  async tick(): Promise<{ webhooks: number; outbox: number }> {
    if (this.running) {
      return { webhooks: 0, outbox: 0 };
    }
    this.running = true;
    try {
      const webhooks = await this.processWebhooks();
      const outbox = await this.processOutbox();
      return { webhooks, outbox };
    } finally {
      this.running = false;
    }
  }

  private async processWebhooks(): Promise<number> {
    const due = await listDueWebhookEvents(this.batchSize);
    let processed = 0;
    for (const event of due) {
      try {
        await processWebhookEvent(event.id);
        processed += 1;
      } catch (error) {
        this.logger.error({ err: error, webhookId: event.id }, 'Webhook processing failed');
      }
    }
    return processed;
  }

  private async processOutbox(): Promise<number> {
    const due = await listDueOutboxEvents(this.batchSize);
    const publisher = getEventPublisher();
    let delivered = 0;

    for (const event of due) {
      const claimed = await claimOutboxEvent(event.id);
      if (!claimed) {
        continue;
      }

      try {
        await publisher.deliver(claimed);
        await prisma.outboxEvent.update({
          where: { id: claimed.id },
          data: {
            status: 'DELIVERED',
            attempts: claimed.attempts + 1,
            deliveredAt: new Date(),
            lastError: null,
          },
        });
        delivered += 1;
      } catch (error) {
        const attempts = claimed.attempts + 1;
        const delay = nextAttemptDelayMs(attempts);
        const message = error instanceof Error ? error.message : 'delivery failed';
        await prisma.outboxEvent.update({
          where: { id: claimed.id },
          data: {
            status: delay === null ? 'DEAD' : 'FAILED',
            attempts,
            lastError: message,
            nextAttemptAt: delay === null ? claimed.nextAttemptAt : new Date(Date.now() + delay),
          },
        });
        this.logger.warn(
          { outboxId: claimed.id, attempts, error: message },
          'Outbox delivery failed',
        );
      }
    }

    return delivered;
  }
}
