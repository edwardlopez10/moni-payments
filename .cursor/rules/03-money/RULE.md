# Money invariants

All monetary amounts in this service use integer minor units. Floating point is forbidden for money.

## Representation

- Amounts are `Int` minor units with an explicit ISO 4217 `currency` code (e.g. `8500` + `USD` = $85.00).
- Zod schemas reject non-integers; never round client-supplied floats silently.
- Valid range: `1` to `2_000_000_000` minor units per charge.

## Arithmetic

- Refund validation uses integer subtraction (`amount - refundedAmount`).
- `Payment.refundedAmount` is updated in the same transaction as a successful refund.
- The database `CHECK (refunded_amount <= amount)` is the final guarantee under concurrency.

## API contract

- Every request and response carrying money uses `{ amount, currency }` or parallel top-level fields — never decimals.
- `refundableAmount` is computed at read time, not stored, so clients do not reimplement refund rules.

## Review checklist

- No `parseFloat`, division by 100 for persistence, or `Number` coercion on amounts from JSON without integer validation.
- No `BigInt` in API responses unless a documented migration widens storage (not current scope).
- Currency mismatch between payment and refund returns an error before any provider call.
