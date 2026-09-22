/** ISO 4217 currencies supported at the domain layer, with minor-unit exponents. */
export interface CurrencyDefinition {
  code: string;
  /** Number of digits after the decimal separator in common notation. */
  minorUnits: number;
  symbol: string;
}

const CURRENCIES: Record<string, CurrencyDefinition> = {
  USD: { code: 'USD', minorUnits: 2, symbol: '$' },
  GTQ: { code: 'GTQ', minorUnits: 2, symbol: 'Q' },
  HNL: { code: 'HNL', minorUnits: 2, symbol: 'L' },
  CRC: { code: 'CRC', minorUnits: 2, symbol: '₡' },
  COP: { code: 'COP', minorUnits: 2, symbol: '$' },
  MXN: { code: 'MXN', minorUnits: 2, symbol: '$' },
  EUR: { code: 'EUR', minorUnits: 2, symbol: '€' },
};

export function isKnownCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function getCurrency(code: string): CurrencyDefinition {
  const currency = CURRENCIES[code];
  if (!currency) {
    throw new Error(`Unknown currency: ${code}`);
  }
  return currency;
}

export function listCurrencies(): readonly CurrencyDefinition[] {
  return Object.values(CURRENCIES);
}
