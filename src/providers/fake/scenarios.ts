export const FakeScenario = {
  SUCCESS: 'success',
  INSTANT_SUCCESS: 'instant_success',
  DECLINED: 'declined',
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  PROCESSING: 'processing',
  DELAYED_SUCCESS: 'delayed_success',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  DUPLICATE_WEBHOOK: 'duplicate_webhook',
  OUT_OF_ORDER_WEBHOOK: 'out_of_order_webhook',
  REFUND_FAILURE: 'refund_failure',
} as const;

export type FakeScenario = (typeof FakeScenario)[keyof typeof FakeScenario];

const SCENARIO_VALUES = new Set<string>(Object.values(FakeScenario));

export function resolveFakeScenario(metadata: Record<string, string>): FakeScenario {
  const raw = metadata.fakeScenario;
  if (raw === undefined || raw === '') {
    return FakeScenario.SUCCESS;
  }
  if (!SCENARIO_VALUES.has(raw)) {
    return FakeScenario.SUCCESS;
  }
  return raw as FakeScenario;
}

export function fakeDelayMs(metadata: Record<string, string>): number {
  const raw = metadata.fakeDelayMs;
  if (raw === undefined || raw === '') {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
