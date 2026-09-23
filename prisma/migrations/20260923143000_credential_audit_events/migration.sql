-- CreateEnum
CREATE TYPE "CredentialAuditActorType" AS ENUM ('SERVICE_CLIENT', 'OPERATOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CredentialAuditOperation" AS ENUM ('PUT', 'ROTATION', 'DELETE', 'EXISTS', 'GET', 'LIFECYCLE');

-- CreateEnum
CREATE TYPE "CredentialAuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "credential_audit_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payment_account_id" TEXT NOT NULL,
    "actor_type" "CredentialAuditActorType" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "operation" "CredentialAuditOperation" NOT NULL,
    "outcome" "CredentialAuditOutcome" NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credential_audit_events_organization_id_created_at_idx" ON "credential_audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "credential_audit_events_payment_account_id_created_at_idx" ON "credential_audit_events"("payment_account_id", "created_at");
