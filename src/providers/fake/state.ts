import type {
  Money,
  NormalizedPaymentStatus,
  PaymentMethodResult,
  PaymentResult,
  ProviderFailure,
  RefundResult,
} from '../types';
import type { FakeScenario } from './scenarios';

export interface StoredPayment {
  result: PaymentResult;
  scenario: FakeScenario;
  refundedAmount: number;
  idempotencyKey: string;
}

export interface StoredPaymentMethod {
  result: PaymentMethodResult;
  setupToken: string;
}

export interface StoredRefund {
  result: RefundResult;
  providerPaymentId: string;
  idempotencyKey: string;
}

export interface PendingWebhook {
  emitAt: number;
  payload: Record<string, unknown>;
}

export class FakeProviderState {
  readonly payments = new Map<string, StoredPayment>();
  readonly paymentsByIdempotency = new Map<string, string>();
  readonly methods = new Map<string, StoredPaymentMethod>();
  readonly refunds = new Map<string, StoredRefund>();
  readonly refundsByIdempotency = new Map<string, string>();
  readonly pendingWebhooks: PendingWebhook[] = [];

  reset(): void {
    this.payments.clear();
    this.paymentsByIdempotency.clear();
    this.methods.clear();
    this.refunds.clear();
    this.refundsByIdempotency.clear();
    this.pendingWebhooks.length = 0;
  }

  storePayment(
    result: PaymentResult,
    scenario: FakeScenario,
    idempotencyKey: string,
  ): PaymentResult {
    this.payments.set(result.providerPaymentId, {
      result,
      scenario,
      refundedAmount: 0,
      idempotencyKey,
    });
    this.paymentsByIdempotency.set(idempotencyKey, result.providerPaymentId);
    return result;
  }

  updatePaymentStatus(
    providerPaymentId: string,
    status: NormalizedPaymentStatus,
    failure?: ProviderFailure,
  ): PaymentResult {
    const stored = this.payments.get(providerPaymentId);
    if (!stored) {
      throw new Error(`Unknown payment ${providerPaymentId}`);
    }
    const next: PaymentResult = {
      ...stored.result,
      status,
      providerMetadata: { ...stored.result.providerMetadata },
    };
    if (failure !== undefined) {
      next.failure = failure;
    } else {
      delete next.failure;
    }
    stored.result = next;
    return next;
  }

  enqueueWebhook(payload: Record<string, unknown>, emitAt: number): void {
    this.pendingWebhooks.push({ payload, emitAt });
  }

  drainWebhooks(now: number): Record<string, unknown>[] {
    const due: Record<string, unknown>[] = [];
    const remaining: PendingWebhook[] = [];
    for (const item of this.pendingWebhooks) {
      if (item.emitAt <= now) {
        due.push(item.payload);
      } else {
        remaining.push(item);
      }
    }
    this.pendingWebhooks.length = 0;
    this.pendingWebhooks.push(...remaining);
    return due;
  }

  refundableRemaining(providerPaymentId: string): Money | undefined {
    const stored = this.payments.get(providerPaymentId);
    if (!stored) {
      return undefined;
    }
    return {
      amount: stored.result.amount.amount - stored.refundedAmount,
      currency: stored.result.amount.currency,
    };
  }
}
