import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '../../../src/domain/errors';
import { FakePaymentProvider } from '../../../src/providers/fake';
import {
  createRegistry,
  providerKeySchema,
} from '../../../src/providers/registry';
import { ProviderCapability } from '../../../src/providers/capabilities';

describe('provider registry', () => {
  const fake = new FakePaymentProvider();
  const registry = createRegistry([fake]);

  it('throws PROVIDER_NOT_FOUND for an unknown key', () => {
    expect(() => registry.get('pagadito')).toThrow(AppError);
    try {
      registry.get('pagadito');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.PROVIDER_NOT_FOUND);
    }
  });

  it('returns descriptors that match each adapter declaration', () => {
    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual({
      key: fake.key,
      displayName: fake.displayName,
      capabilities: [...fake.capabilities],
      supportedCurrencies: [...fake.supportedCurrencies],
    });
  });

  it('reports capabilities from the adapter', () => {
    expect(registry.supports('fake', ProviderCapability.REFUNDS)).toBe(true);
    expect(registry.supports('missing', ProviderCapability.REFUNDS)).toBe(false);
  });

  it('builds a Zod schema from keys()', () => {
    const schema = providerKeySchema(registry);
    expect(schema.parse('fake')).toBe('fake');
    expect(() => schema.parse('unknown')).toThrow();
  });
});
