---
resource:
  id: "RS-005"
  title: "AWS Secrets Manager Documentation"
  source: "https://docs.aws.amazon.com/secretsmanager/"
  spec_slug: "aws-secrets-manager-credential-storage"
  created: "2026-09-22T23:10:00Z"
  updated: "2026-09-22T23:10:00Z"
---

# AWS Secrets Manager Documentation

## Source
https://docs.aws.amazon.com/secretsmanager/

## Summary
The documentation landing page. It links the User Guide (concepts, creating, retrieving, rotating
secrets) and the API Reference (operations, request/response shapes, errors). It is the anchor for
the operation semantics and error handling that the AWS-backed provider must implement for R-003,
and for the migration path in R-009.

## Key Insights
- **Product model.** Secrets are encrypted at rest with KMS and retrieved over TLS at the moment
  they're needed, rather than being hardcoded or copied into app configuration. This matches R-002
  exactly.
- **Two reference tracks:**
  - The User Guide covers concepts: versions and staging labels (`AWSCURRENT`/`AWSPREVIOUS`),
    deletion with a recovery window, tagging, and encryption.
  - The API Reference covers exact operations and error types.
- **Error types that matter to the provider:**
  - `ResourceNotFoundException`
  - `ResourceExistsException`
  - `InvalidRequestException` (for example, reading a secret scheduled for deletion)
  - `AccessDeniedException`
  - `DecryptionFailure`
  - `LimitExceededException` and throttling
  - `InternalServiceError`
- **SecretString.** A secret value is a string, typically JSON. It fits the
  `{ clientId, clientSecret, ... }` credential bundle, so one secret holds one payment account.

## Spec Alignment
- **R-003:** the generic `get<T>` / `put<T>` in the target interface maps onto a JSON-encoded
  `SecretString`. `T` must be validated with a per-provider schema on read. A secret whose shape
  doesn't match should fail closed, not be passed through.
- **R-001 / R-002:** one secret per payment account (not per organization) keeps blast radius and
  IAM scoping per account. It also makes `delete` on account removal trivial.
- **R-009:** the existing `env://` scheme can stay registered alongside the new AWS scheme as a
  dev/test-only provider. Existing staging rows then need a one-time migration: read from env, `put`
  to AWS, and rewrite the reference. After that, `env://` is disabled in production.
- **R-005:** the lifecycle interacts with secret existence. Typical checks:
  - `ONBOARDING` → `PENDING_VERIFICATION` requires `exists(secretRef)`.
  - Entering `DISABLED` may schedule `delete`.
  - `REJECTED` accounts should have their secret deleted.

## Implementation Blueprint
- SDK: AWS SDK for JavaScript v3, `@aws-sdk/client-secrets-manager`, using the default credential
  provider chain. Configure the region explicitly per environment; never rely on implicit defaults.
- The provider maps AWS errors to domain errors:
  - Not found → `SECRET_NOT_FOUND` (internal).
  - Access denied or decryption failure → `PROVIDER_CONFIGURATION_ERROR`, plus an alert.
  - Throttling or internal error → retry with bounded backoff, then a retryable 503.

  Only an error code and a correlation id reach logs. The reference is logged only as a hash, or as
  the account id, never the full name, if we want to avoid leaking the org structure.
- Test strategy:
  - An in-memory `SecretsProvider` for unit and integration tests (it already fits the current test
    harness).
  - An opt-in contract test suite, run against both the in-memory provider and real AWS (staging
    sandbox), asserting identical `put/get/delete/exists` semantics.
  - Optionally LocalStack for CI, noting that it does not enforce IAM by default, so it can't
    validate R-007.

## Risks & Considerations
- The landing page is navigational. Specific limits (secret size, name length, API rate quotas),
  pricing, and deletion semantics must be confirmed in the User Guide and API Reference during
  `update_spec`.
- Changing the interface from `resolve(): string` to typed `get<T>()` touches every current caller:
  - `provider-selection`
  - `webhooks/service`
  - `events/publisher`
  - the fake provider
  - dev routes

  The migration must be staged so no caller silently receives `undefined`.
- Cost scales with number of secrets and API calls. Per-account secrets plus caching keep this
  predictable, but it should be monitored (RS-004).
