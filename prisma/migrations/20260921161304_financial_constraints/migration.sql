-- Financial invariants Prisma cannot express.
-- These must hold under concurrency; application checks alone are not enough.

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT payments_refund_non_negative CHECK (refunded_amount >= 0),
  ADD CONSTRAINT payments_refund_within_total CHECK (refunded_amount <= amount),
  ADD CONSTRAINT payments_currency_iso CHECK (currency ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX payment_accounts_one_default_per_org
  ON payment_accounts (organization_id)
  WHERE is_default = true;

CREATE UNIQUE INDEX payment_methods_one_default_per_customer
  ON payment_methods (organization_id, customer_reference)
  WHERE is_default = true AND status = 'ACTIVE';
