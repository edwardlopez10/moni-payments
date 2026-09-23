---
resource:
  id: "RS-004"
  title: "AWS Secrets Manager Best Practices"
  source: "https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html"
  spec_slug: "aws-secrets-manager-credential-storage"
  created: "2026-09-22T23:10:00Z"
  updated: "2026-09-22T23:10:00Z"
---

# AWS Secrets Manager Best Practices

## Source
https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html

## Summary
AWS's security guidance for Secrets Manager: key choice, caching, rotation, CLI exposure,
least-privilege access, replication, monitoring, and private networking. It supplies the concrete
hardening choices behind R-007 and R-008, and the operational trade-offs (caching, audit)
that affect R-006 at runtime.

## Key Insights
- **Encryption key.** AWS recommends `aws/secretsmanager` for most cases. However, a customer
  managed key is required to apply a key policy. When used, restrict it with
  `kms:ViaService = secretsmanager.<region>.amazonaws.com` and, optionally, Secrets Manager
  encryption-context conditions.
- **Caching.** AWS recommends client-side caching. Official caching clients exist for Java,
  Python, .NET, Go, and Rust, but **not Node.js**. Any cache here is ours to build and secure.
- **Rotation.** Recommended, with Lambda-based strategies. For third-party payment-provider
  credentials, rotation usually requires the provider's cooperation. Our "rotation" is realistically
  a new `put` of provider-issued credentials.
- **CLI exposure.** Shell history and process listings can leak secrets entered on the command
  line. Operators must never seed provider credentials via `aws secretsmanager ... --secret-string`.
- **Least privilege.** Use IAM, resource policies, and ABAC. Use `BlockPublicPolicy` if resource
  policies are allowed. Be careful with `aws:SourceIp` conditions, which are unreliable when AWS
  services act on your behalf.
- **Monitoring.** Use CloudTrail (every API call), CloudWatch, AWS Config compliance rules, cost
  monitoring, and GuardDuty threat detection.
- **Private networking.** Use VPC endpoints. This is unavailable on Railway, so traffic goes over
  the public endpoint with TLS.

## Spec Alignment
- **R-007:** a customer managed key per environment, whose key policy trusts only that
  environment's runtime principal. This is the strongest isolation available inside one AWS
  account, and it is independent of the IAM policy.
- **R-008:**
  - CloudTrail covers "every access is attributable". Each `GetSecretValue` records the principal,
    secret ARN, and time.
  - We must also emit our own structured audit log (organization id, payment account id,
    operation, and outcome, never the value). This correlates AWS events to tenants.
  - The CLI guidance becomes a rule: credentials enter only through the service API (R-004), never
    through operator shells.
- **R-006 / availability:** caching reduces latency, cost, and the blast radius of a Secrets
  Manager outage on payment creation. It also extends the lifetime of plaintext in memory.
- **Not relevant now:** replication (single region is fine at this stage), and Lambda rotation
  (provider credentials are rotated by the provider).

## Implementation Blueprint
- **In-process cache** in the AWS provider:
  - Keyed by secret reference, with a short TTL (for example 60–300 s) and a bounded size.
  - Invalidated on `put` and `delete`.
  - Never serialized, logged, or shared across processes.
  - Cache misses and AWS errors surface as a sanitized `PROVIDER_CONFIGURATION_ERROR` that never
    includes the reference value in client-facing responses.
- **KMS key policy** per environment:
  - `kms:ViaService` = `secretsmanager.<region>.amazonaws.com`.
  - Principal = that environment's runtime principal.
  - `kms:EncryptionContext:SecretARN` prefix-matched to the environment's name prefix.
- **Observability:**
  - Turn on CloudTrail (management events cover Secrets Manager API calls).
  - Add a CloudWatch alarm on `AccessDenied` spikes for the runtime principals, which catches
    misconfiguration or probing.
  - Add an AWS Config rule so secrets can't exist without the `Environment` tag.
- **Operator seeding** only goes through the service API, or a script that reads from stdin or a
  file, never command-line arguments.

## Risks & Considerations
- A cache trades freshness for availability. A TTL that's too long delays credential updates, and
  one that's too short increases cost and outage sensitivity. Choose per environment in
  `update_spec`.
- With no VPC endpoint on Railway, the only network protection is TLS plus IAM. That makes
  bootstrap-credential hygiene (RS-001 risk) the dominant factor.
- Plaintext secrets inevitably exist in process memory while in use. Minimize their lifetime: don't
  hold them on long-lived objects, and don't attach them to request contexts that loggers or error
  serializers can reach.
- The AWS managed key is cheaper and simpler, but it is shared by all principals in the account.
  Choosing it would weaken R-007 to "IAM policy only".
