import { describe, expect, it } from 'vitest';

import {
  addMoney,
  assertValidMoney,
  createMoney,
  formatMoney,
  MAX_AMOUNT_MINOR_UNITS,
  subtractMoney,
} from '../../../src/domain/money';
import { AppError, ErrorCode } from '../../../src/domain/errors';

describe('money', () => {
  it('accepts integer minor units', () => {
    expect(createMoney(8500, 'USD')).toEqual({ amount: 8500, currency: 'USD' });
  });

  it('rejects non-integers rather than rounding', () => {
    expect(() => assertValidMoney({ amount: 85.5, currency: 'USD' })).toThrow(AppError);
    try {
      assertValidMoney({ amount: 85.5, currency: 'USD' });
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.VALIDATION_ERROR);
    }
  });

  it('rejects zero, negative, and amounts above the maximum', () => {
    expect(() => createMoney(0, 'USD')).toThrow(AppError);
    expect(() => createMoney(-1, 'USD')).toThrow(AppError);
    expect(() => createMoney(MAX_AMOUNT_MINOR_UNITS + 1, 'USD')).toThrow(AppError);
  });

  it('rejects unknown currency codes', () => {
    expect(() => createMoney(100, 'ZZZ')).toThrow(AppError);
    try {
      createMoney(100, 'ZZZ');
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.CURRENCY_NOT_SUPPORTED);
    }
  });

  it('rejects arithmetic on mismatched currencies', () => {
    const usd = createMoney(100, 'USD');
    const mxn = createMoney(100, 'MXN');
    expect(() => addMoney(usd, mxn)).toThrow(AppError);
    expect(() => subtractMoney(usd, mxn)).toThrow(AppError);
  });

  it('formats 8500 USD as $85.00 without floating point division', () => {
    expect(formatMoney(createMoney(8500, 'USD'))).toBe('$85.00');
    expect(formatMoney(createMoney(1, 'USD'))).toBe('$0.01');
    expect(formatMoney(createMoney(100, 'USD'))).toBe('$1.00');
  });
});
