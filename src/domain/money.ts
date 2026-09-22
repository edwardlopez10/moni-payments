import { AppError, ErrorCode } from './errors';
import { getCurrency, isKnownCurrency } from './currencies';

/** Absolute upper bound for a single payment, in minor units. */
export const MAX_AMOUNT_MINOR_UNITS = 2_000_000_000;

export interface Money {
  /** Integer minor units. 8500 === USD 85.00 */
  amount: number;
  /** ISO 4217 alpha-3 */
  currency: string;
}

export function assertValidMoney(money: Money): asserts money is Money {
  const { amount, currency } = money;

  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be an integer in minor units.', {
      details: [{ field: 'amount', issue: 'must be a positive integer in minor units' }],
    });
  }

  if (amount <= 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be greater than zero.', {
      details: [{ field: 'amount', issue: 'must be a positive integer in minor units' }],
    });
  }

  if (amount > MAX_AMOUNT_MINOR_UNITS) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount exceeds the allowed maximum.', {
      details: [
        {
          field: 'amount',
          issue: `must be at most ${MAX_AMOUNT_MINOR_UNITS} minor units`,
        },
      ],
    });
  }

  if (!isKnownCurrency(currency)) {
    throw new AppError(ErrorCode.CURRENCY_NOT_SUPPORTED, `Currency ${currency} is not supported.`, {
      details: [{ field: 'currency', issue: 'unknown or unsupported ISO 4217 code' }],
    });
  }
}

export function createMoney(amount: number, currency: string): Money {
  const money = { amount, currency };
  assertValidMoney(money);
  return money;
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Currency mismatch.', {
      details: [
        {
          field: 'currency',
          issue: `expected ${a.currency}, got ${b.currency}`,
        },
      ],
    });
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertValidMoney(a);
  assertValidMoney(b);
  assertSameCurrency(a, b);
  return createMoney(a.amount + b.amount, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertValidMoney(a);
  assertValidMoney(b);
  assertSameCurrency(a, b);
  if (b.amount > a.amount) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Resulting amount would be negative.', {
      details: [{ field: 'amount', issue: 'subtraction exceeds available amount' }],
    });
  }
  // Zero is allowed as a result of exact exhaustion (e.g. refund remainder math),
  // but createMoney rejects zero — return a validated non-create path only for internals.
  if (b.amount === a.amount) {
    return { amount: 0, currency: a.currency };
  }
  return createMoney(a.amount - b.amount, a.currency);
}

/**
 * Formats minor units for display. Uses integer arithmetic only — never converts
 * the amount into a JavaScript floating-point number.
 */
export function formatMoney(money: Money): string {
  assertValidMoney(money);
  const { minorUnits, symbol } = getCurrency(money.currency);
  const negative = money.amount < 0;
  const absolute = negative ? -money.amount : money.amount;
  const factor = 10 ** minorUnits;
  const major = Math.trunc(absolute / factor);
  const fraction = absolute % factor;
  const fractionPart =
    minorUnits === 0 ? '' : `.${fraction.toString().padStart(minorUnits, '0')}`;
  return `${negative ? '-' : ''}${symbol}${major}${fractionPart}`;
}
