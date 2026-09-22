import type { PaymentMethod } from '@prisma/client';

import { iso } from '../../platform/http/schemas';
import type { PaymentMethodResponse } from './schema';

export function toPaymentMethodResponse(row: PaymentMethod): PaymentMethodResponse {
  return {
    id: row.id,
    customerReference: row.customerReference,
    provider: row.provider,
    type: row.type,
    status: row.status,
    brand: row.brand,
    last4: row.last4,
    expirationMonth: row.expirationMonth,
    expirationYear: row.expirationYear,
    isDefault: row.isDefault,
    createdAt: iso(row.createdAt)!,
  };
}
