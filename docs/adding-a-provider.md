# Adding a payment provider

Adding a provider should touch only the adapter folder, the registry, contract tests, and documentation — not core payment logic, the Prisma schema, or existing adapters.

This walkthrough uses **Pagadito** as the worked example. The same six steps apply to Wompi, PayWay, or any future provider.

## 1. Create the adapter

Add `src/providers/pagadito/index.ts` implementing `PaymentProvider` from `src/providers/types.ts`:

```ts
export class PagaditoProvider implements PaymentProvider {
  readonly key = 'pagadito';
  readonly displayName = 'Pagadito';
  readonly capabilities = new Set<ProviderCapability>([
    ProviderCapability.WEBHOOKS,
    ProviderCapability.WEBHOOK_SIGNATURE_VERIFICATION,
    ProviderCapability.REFUNDS,
    // declare only what Pagadito actually supports
  ]);
  readonly supportedCurrencies = ['USD', 'GTQ', 'HNL'];

  async createPayment(input, ctx): Promise<PaymentResult> { /* ... */ }
  async refundPayment(input, ctx): Promise<RefundResult> { /* ... */ }
  async verifyWebhook(raw, ctx): Promise<WebhookVerificationResult> { /* ... */ }
  async parseWebhook(raw): Promise<NormalizedWebhookEvent> { /* ... */ }
  // optional: tokenization, cancel, pollStatus, etc.
}
```

Keep Pagadito HTTP types and SDK usage inside this folder. Do not import Pagadito packages anywhere else.

## 2. Normalize status and errors

Map Pagadito status strings to `NormalizedPaymentStatus` (`PENDING`, `PROCESSING`, `PAID`, `FAILED`, …).

Map Pagadito error codes to `ProviderFailureCode` inside the adapter. Upstream code sees Moniveo error codes only; Pagadito-specific codes go in `providerMetadata` for support.

## 3. Declare capabilities honestly

If Pagadito does not support partial refunds, omit `PARTIAL_REFUNDS`. The refund service rejects unsupported operations with `CAPABILITY_NOT_SUPPORTED` before any provider call.

If webhooks are unsigned, declare `WEBHOOKS` without `WEBHOOK_SIGNATURE_VERIFICATION` so ingestion policy is explicit.

## 4. Register the provider

Add one line in `src/providers/registry.ts`:

```ts
defaultRegistry = createRegistry([
  new FakePaymentProvider(),
  new PagaditoProvider(httpClient),
]);
```

`GET /v1/providers` and payment-account validation automatically include the new key.

## 5. Add contract tests

Create `tests/contract/pagadito.contract.test.ts`:

```ts
import { PagaditoProvider } from '../../src/providers/pagadito';
import { runPaymentProviderContract } from './payment-provider.contract';

runPaymentProviderContract(() => new PagaditoProvider(mockClient));
```

The shared suite covers create, refund, webhook verification, and capability declarations. Use recorded HTTP fixtures rather than live sandboxes in CI.

## 6. Document credential field names

Document the credential field names the adapter reads from the secret bundle. Callers send those values on create, patch, or rotate. They do not send references, and they do not choose where the secret is stored. The service writes the bundle and keeps only `secretRef`.

| Key | Description |
| --- | --- |
| `apiKey` | Pagadito API credential |
| `webhookSecret` | HMAC signing secret for webhooks |
| `merchantUid` | Pagadito merchant identifier, also stored in `providerMerchantId` on the account |

Products create accounts via `POST /v1/organizations/:id/payment-accounts` with `provider: "pagadito"` and a `credentials` object containing those values.

## Review heuristic

If a pull request adding Pagadito modifies `src/domain/`, `src/modules/payments/`, or `prisma/schema.prisma`, the abstraction likely leaked. Stop and refactor so the adapter absorbs provider-specific behaviour.
