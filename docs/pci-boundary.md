# PCI boundary

Moniveo Payments is designed to stay **outside** the cardholder data environment (CDE). Products and providers handle card collection; this service orchestrates tokenized payments only.

## What we store

| Data | Stored | Notes |
| --- | --- | --- |
| Provider payment method token (`providerPaymentMethodId`) | yes | Opaque provider identifier |
| Display metadata (brand, last4, expiration) | yes | Safe for UI |
| Provider payment/refund IDs | yes | Reconciliation |
| Customer identity | no table | `customerReference` string owned by the product |
| Full PAN, CVV, track data | **never** | Forbidden by schema and CI |

Payment method creation accepts only a `setupToken` from provider-hosted tokenization — there is no request field capable of carrying a card number.

## What we never touch

- Full card numbers (PAN)
- Card verification values (CVV/CVC)
- Magnetic stripe or EMV track data
- Provider secret values (PostgreSQL stores `secretRef` only; the bundle lives in the secret store)
- Plaintext API keys in the database, logs, or API responses

CI greps `src/` and `prisma/` for `cardNumber`, `cvv`, `pan`, and `track2`. Domain-boundary rules forbid introducing card-collection endpoints.

## Card collection flow

1. The payer enters card data on a **provider-hosted** page or SDK controlled by Pagadito, Wompi, etc.
2. The provider returns a single-use `setupToken` or charge token to the product frontend.
3. The product backend calls Payments with the token only.
4. Payments forwards the token to the provider adapter; no card data transits our API.

For local development, `POST /dev/fake-provider/payment-methods/setup-token` mints fake setup tokens with chosen brand and last4 — still no PAN.

## SAQ posture

Because Moniveo Payments:

- does not store, process, or transmit cardholder data,
- uses provider tokenization for all card payments, and
- documents the boundary in schemas, tests, and CI guards,

the expected PCI posture for this component is **SAQ A** or **SAQ A-EP** depending on how checkout is embedded in product UIs (redirect vs embedded iframe). The product and provider remain responsible for their portions of the CDE.

This document is not legal or QSA advice. Engage a PCI assessor before going live with real card data in production.

## Logging and support

Logs must never contain PAN, CVV, raw webhook bodies with card data, or resolved secrets. Redaction paths are configured in `src/platform/logging/logger.ts` and asserted in integration tests.

Provider support tickets may reference `providerMetadata` and `providerCode` stored on attempts — never fields returned to calling products.
