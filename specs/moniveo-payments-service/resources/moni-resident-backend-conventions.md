---
resource:
  id: "RS-003"
  title: "Moniveo Resident Backend Conventions"
  source: "/Users/edward/Documents/moni-resident"
  spec_slug: "moniveo-payments-service"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-18T22:45:00Z"
---

# Moniveo Resident Backend Conventions

## Source

`/Users/edward/Documents/moni-resident`, principally `apps/backend/`, `packages/shared/`, and
`.cursor/rules/`. Resident is the intended first consumer of `moniveo-payments`, so its conventions
matter twice: as a source of house style, and as the shape of the integration.

## Summary

Resident's backend is Next.js 14 App Router API routes with Prisma, stateless JWT authentication,
and header-driven multi-tenancy. Its tests mock Prisma entirely. The pieces worth carrying forward
are the shared-types discipline, the `.cursor/rules/` practice, and the tenancy-header pattern; the
transport model and the testing approach are not transferable to a financial service.

## Key Insights

- **Transport.** File-based `route.ts` handlers exporting `GET` / `POST`. Not applicable to a
  Fastify service, but the handler body shape — parse, validate, delegate to a service, map errors —
  is the same discipline.
- **Shared types.** `packages/shared` exports domain entities and request/response interfaces
  (`LoginRequest`, `ApiError`). Domain constants are declared as `const` objects rather than
  TypeScript enums for Prisma interoperability, a pattern reused here for `ProviderCapability`.
- **Auth.** Stateless JWT, `Authorization: Bearer`, verified by `verifyAuth()` which returns a
  user object. The important transferable property is that authentication produces a
  *request-scoped context object* rather than scattering claim checks through handlers.
- **Multi-tenancy by header.** `X-Active-Membership` selects the active membership and
  `X-Residential-Id` lets a superadmin cross tenants, resolved centrally in
  `lib/services/membership.ts`. Confirms that centralised tenant resolution is the house approach.
- **Errors.** Custom classes (`AuthenticationError`, `ForbiddenError`) carrying a status, thrown in
  middleware and caught per route. Responses are `{ error, message }`. There is **no shared error
  code enum** in either repo.
- **Prisma.** `@default(uuid())`, `@@map` on models, `@@index` on tenant and lookup columns. Unlike
  `moni-health`, fields are not individually `@map`ped. Uses `SHADOW_DATABASE_URL`.
- **Testing.** Vitest with `vi.mock('@prisma/client')` and `vi.hoisted()`, tests in
  `apps/backend/__tests__/`, no integration tests and no real database.
- **`.cursor/rules/`.** Five numbered rule folders — architecture, security, testing,
  internationalization, ui-design — stating short, enforceable invariants. The testing rule is
  blunt: a backend route or service function without success and failure tests is incomplete.
- **Tooling.** Node `20.19.4` pinned in `.nvmrc`, pnpm 9.15.0, `shamefully-hoist=true`,
  TypeScript `strict: true`.

## Spec Alignment

| Requirement | What is inherited |
| --- | --- |
| R-006 | centralised tenant resolution rather than per-handler checks |
| R-027 | authentication yielding a request-scoped context, here `ServiceContext` with `sourceProduct` |
| R-028 | typed error classes carrying an HTTP status, extended here with a stable `code` |
| R-031 | the "untested route is incomplete" rule, as `.cursor/rules/02-testing/RULE.md` |
| R-025 | the callback contract Resident will implement to receive `payment.*` events |

## Implementation Blueprint

**Adopt**: Node 20.19.4 via `.nvmrc`; `shamefully-hoist=true`; the `.cursor/rules/` practice, with
folders for architecture, security, testing, and money; const-object unions over TypeScript enums
for values crossing the Prisma boundary; centralised tenant resolution.

**Extend**: Resident's `ApiError` is `{ error, message, statusCode }` with free-text `error` values.
A payments API needs a closed, documented code set so callers can branch reliably — hence the
`ErrorCode` union in the API specification. This is a strict superset of the existing shape and is a
candidate to backport to Resident.

**Reject, with reasons**:

- *Mocked Prisma in tests.* Resident's approach cannot validate the guarantees that matter most
  here, all of which are database behaviour: the unique index preventing duplicate charges, the
  unique index deduplicating webhooks, and the `CHECK` constraint preventing over-refunding. Mocked
  Prisma would report all three green with the constraints missing. Integration tests run against a
  real Postgres.
- *Field naming without `@map`.* The two repos disagree; `moni-health`'s explicit field `@map` wins
  because snake_case columns are friendlier to the SQL that finance and support people write
  directly against a payments database.
- *Header-based tenancy.* `X-Active-Membership` suits an end-user session. Service-to-service calls
  name the organization in the path or body, which is explicit and easier to audit.

## Integration contract with Resident

Resident is the milestone-1 consumer, so the boundary is fixed now:

- Resident creates an `Organization` per condominium administration with
  `sourceProduct: RESIDENT` and `externalId` set to its own `Residential.id`.
- Resident sends `customerReference` as its `User.id` and `externalReference` as a stable fee
  identifier such as `fee-2026-09/unit-402`.
- Payments never learns what a unit, a resident, or a fee is, and never reads Resident's database.
- Resident registers an `EventSubscription` and receives signed `payment.*` callbacks, verifying
  `X-Moniveo-Signature` and deduplicating on `X-Moniveo-Event-Id`.
- Resident decides authorisation — who may pay what — before calling. Payments performs no
  authorisation beyond confirming the caller owns the organization.

`tests/helpers/simulated-product-backend.ts` implements exactly this contract, so the milestone-1
demonstration runs end to end before Resident writes any integration code.

## Risks & Considerations

- Resident's payment-related UI copy exists but there is no backend integration point yet. Building
  the real receiver is deliberately outside milestone 1 (confirmed 2026-09-18), so the contract above
  is the specification Resident implements against when its billing work is scheduled. Until then the
  simulated backend in `tests/helpers/` is the only consumer, which keeps the milestone demonstrable
  without depending on another team's timeline.
- `moni-resident` uses `SHADOW_DATABASE_URL`; this service does not need one for local Postgres, but
  a managed production database may require it. Noted in `.env.example` as optional.
- Resident specs explicitly scope payments out (`residence-and-user-status`: "No new billing or
  payment implementation is in scope"), which confirms this service is greenfield with no hidden
  prior art to reconcile.
