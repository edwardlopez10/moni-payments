---
resource:
  id: "RS-001"
  title: "AWS Secrets Manager Authentication and Access Control"
  source: "https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access.html"
  spec_slug: "aws-secrets-manager-credential-storage"
  created: "2026-09-22T23:10:00Z"
  updated: "2026-09-22T23:10:00Z"
---

# AWS Secrets Manager Authentication and Access Control

## Source
https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access.html

## Summary
The entry point to how Secrets Manager authorizes access: IAM authenticates the caller, and
identity-based policies, resource-based policies, and ABAC tags decide which secret operations it
may perform. It defines the security model for R-007 (environment isolation) and R-008
(least-privilege, attributable access). It also shows that KMS key permissions are a second,
independent gate on every read and write.

## Key Insights
- **Two layers of authorization.** Every call must be allowed by IAM policy on the secret (identity
  or resource policy). If the secret uses a customer managed KMS key, the call must also be allowed
  by that key's policy. The AWS managed key `aws/secretsmanager` "automatically has the correct
  permissions", which also means it cannot be used to fence environments apart.
- **Three policy mechanisms:**
  - Identity-based policies attach to the principal the service runs as.
  - Resource-based policies attach to an individual secret.
  - ABAC matches principal tags against secret tags.
  Environment separation can be enforced by any of them. The strongest option combines several.
- **Admin vs. application separation.** AWS explicitly warns against giving end users
  `SecretsManagerReadWrite` + `IAMFullAccess`. The runtime principal for this service must be a
  narrowly scoped application identity, distinct from the human or IaC identity that provisions
  keys and policies.
- **Rotation and replication are separate permission surfaces.** Rotation needs Lambda permissions;
  replication has its own permission gate. Neither is needed at launch. Both should stay
  explicitly denied so they can't be enabled by accident.
- **Auditing.** "Determine who has permissions" (IAM Access Analyzer / policy simulation) is the
  documented way to prove that a staging principal cannot reach production secrets.

## Spec Alignment
- **R-007:** isolation should be enforced by AWS policy, not only by application code. Each
  environment gets its own runtime principal. That principal's policy only covers its own
  environment's secrets and its own environment's KMS key.
- **R-008:** least privilege is achievable because the service needs only a small action set (see
  RS-003). Attribution comes from each environment having a distinct principal, so audit records
  show which deployment touched which secret.
- **R-003:** the provider abstraction owns everything AWS-specific (principal, region, key ID,
  naming). No other module sees IAM concepts.
- **Not relevant now:** rotation Lambdas, cross-region replication, cross-account sharing, and
  on-premises access (IAM Roles Anywhere), though Roles Anywhere may matter for Railway (see Risks).

## Implementation Blueprint
- One runtime principal per environment, for example `moniveo-payments-staging-runtime` and
  `moniveo-payments-production-runtime`. Neither gets console access or admin policies.
- A separate provisioning identity (human or IaC) creates the KMS keys, IAM policies, and naming
  prefix. The runtime principal cannot modify its own policies. It also cannot call
  `PutResourcePolicy`, `DeleteResourcePolicy`, or `ReplicateSecretToRegions`.
- A dedicated customer managed KMS key per environment. The key policy allows `kms:Decrypt`,
  `kms:GenerateDataKey`, and `kms:Encrypt` only to that environment's runtime principal, with
  `kms:ViaService = secretsmanager.<region>.amazonaws.com` (see RS-004).
- Validation: use the IAM policy simulator or Access Analyzer to assert that the staging principal
  gets `Deny` for `GetSecretValue` on a production secret ARN. Add this as a manual deploy
  checklist item.

## Risks & Considerations
- **Railway has no native AWS role attachment.** The documented "IAM role attached to the compute"
  pattern (EC2, ECS, Lambda) is not available. The realistic options are:
  - Long-lived IAM user access keys stored as Railway variables. This is the simplest option and
    the highest risk.
  - IAM Roles Anywhere or an OIDC federation flow to get short-lived credentials. This is more
    complex.

  Whichever is chosen, the bootstrap credential is the one secret that cannot live in Secrets
  Manager. It needs its own rotation plan and must never be shared across environments.
- Relying on `aws/secretsmanager` for isolation is insufficient. Any principal in the account with
  `GetSecretValue` can decrypt with it.
- Policy mistakes fail open silently. Isolation needs an explicit negative test (the staging
  principal is denied production access), not just a positive one.
- **Existing gap.** Today `credentialRefs` are supplied by API callers as `env://NAME`, and the
  service resolves any environment variable named. Under the new model, references must be
  generated by the service and never accepted from callers. Otherwise a caller could point an
  account at another tenant's secret, or at internal configuration.
