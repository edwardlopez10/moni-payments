# Security invariants

These are checkable properties for PCI posture, secret handling, and safe logging.

## PCI boundary

- Never accept, persist, or log full card numbers, CVV/CVC, magnetic track data, or PAN.
- Schemas, Prisma models, and DTOs must not define fields named `cardNumber`, `cvv`, `pan`, or `track2`. CI greps for these patterns.
- Payment methods store only provider tokens plus display-safe metadata (brand, last4, expiration).

## Secrets and credentials

- API keys are hashed at rest; plaintext keys are shown once at creation only.
- Payment account `credentialRefs` store secret references (`env://NAME`), never resolved values.
- Responses expose `credentialKeys` lists, not secret values or reference strings.
- Boot must fail fast when required environment variables are missing or invalid.

## Logging

- Log redaction must replace `[REDACTED]` for: `authorization`, `apiKey`, `webhookSecret`, `credentials`, `setupToken`, `rawBody`.
- Provider error text and stack traces belong in server logs keyed by `requestId`, never in API error `message` fields.

## HTTP hardening

- Helmet security headers on every response.
- Request body size limits return `413` for oversized payloads.
- General API and webhook endpoints have separate rate limits; exceeding limits returns `429`.
- Webhook endpoints authenticate via provider signature, not service API keys.

## Development routes

- `/dev/*` routes register only when `NODE_ENV` is `development` or `test`; they must not exist in production builds.
