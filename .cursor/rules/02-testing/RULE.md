# Testing invariants

An untested route or service function is incomplete. Financial guarantees require real Postgres in integration and e2e tests.

## Coverage expectations

- Every new `/v1` route needs integration tests for success and primary failure paths.
- Every new service function in `src/modules/` needs tests covering success and the errors it can throw.
- Pure domain logic in `src/domain/` requires unit tests with table-driven cases for legal and illegal transitions.
- Every provider adapter must pass `tests/contract/payment-provider.contract.ts`.

## Database-backed guarantees

Mock Prisma only in pure unit tests. These guarantees must be asserted against a real database:

- Unique `(organization_id, external_reference)` prevents duplicate charges.
- Unique `(provider, provider_event_id)` deduplicates webhooks.
- `CHECK (refunded_amount <= amount)` prevents over-refunding.
- Idempotency key insertion under concurrent identical requests.

## Test layers

- `pnpm test:unit` — no Docker required; runs unit and contract tests.
- `pnpm test:integration` and e2e — require Postgres via `docker compose up -d`.
- `pnpm test` runs all layers; CI runs the full suite on every push.

## Assertions over snapshots

- Prefer explicit field assertions on payment and refund payloads over snapshot tests.
- Security tests must assert redaction and absence of forbidden PCI field names in schemas.

## Before merge

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass locally.
- `pnpm openapi:check` passes when routes or schemas changed.
- `pnpm check:domain` passes.
