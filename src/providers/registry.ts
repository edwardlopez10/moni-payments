import { AppError, ErrorCode } from '../domain/errors';
import { FakePaymentProvider } from './fake';
import type { ProviderCapability } from './capabilities';
import type { PaymentProvider } from './types';
import { z } from 'zod';

export interface ProviderDescriptor {
  key: string;
  displayName: string;
  capabilities: ProviderCapability[];
  supportedCurrencies: string[];
}

export interface ProviderRegistry {
  get(key: string): PaymentProvider;
  has(key: string): boolean;
  keys(): readonly string[];
  list(): readonly ProviderDescriptor[];
  supports(key: string, capability: ProviderCapability): boolean;
}

function toDescriptor(provider: PaymentProvider): ProviderDescriptor {
  return {
    key: provider.key,
    displayName: provider.displayName,
    capabilities: [...provider.capabilities],
    supportedCurrencies: [...provider.supportedCurrencies],
  };
}

export function createRegistry(providers: PaymentProvider[]): ProviderRegistry {
  const byKey = new Map<string, PaymentProvider>();
  for (const provider of providers) {
    if (byKey.has(provider.key)) {
      throw new Error(`Duplicate provider key: ${provider.key}`);
    }
    byKey.set(provider.key, provider);
  }

  return {
    get(key: string): PaymentProvider {
      const provider = byKey.get(key);
      if (!provider) {
        throw new AppError(ErrorCode.PROVIDER_NOT_FOUND, `Provider '${key}' is not registered.`);
      }
      return provider;
    },
    has(key: string): boolean {
      return byKey.has(key);
    },
    keys(): readonly string[] {
      return [...byKey.keys()];
    },
    list(): readonly ProviderDescriptor[] {
      return [...byKey.values()].map(toDescriptor);
    },
    supports(key: string, capability: ProviderCapability): boolean {
      const provider = byKey.get(key);
      return provider?.capabilities.has(capability) ?? false;
    },
  };
}

/** Zod enum of registered provider keys — unknown providers fail at the API boundary. */
export function providerKeySchema(registry: ProviderRegistry) {
  const keys = registry.keys();
  if (keys.length === 0) {
    return z.string().refine(() => false, { message: 'No providers are registered.' });
  }
  return z.enum(keys as [string, ...string[]]);
}

let defaultRegistry: ProviderRegistry | undefined;

export function getProviderRegistry(): ProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createRegistry([new FakePaymentProvider()]);
  }
  return defaultRegistry;
}

/** Test helper to replace the process-wide registry. */
export function setProviderRegistryForTests(registry: ProviderRegistry | undefined): void {
  defaultRegistry = registry;
}
