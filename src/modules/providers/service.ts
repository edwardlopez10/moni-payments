import { AppError, ErrorCode } from '../../domain/errors';
import { getProviderRegistry } from '../../providers/registry';
import type { ProviderDescriptorResponse } from './schema';

export function listProviders(): { data: ProviderDescriptorResponse[] } {
  const registry = getProviderRegistry();
  return {
    data: registry.list().map((descriptor) => ({
      ...descriptor,
      available: true,
    })),
  };
}

export function getProviderCapabilities(key: string): ProviderDescriptorResponse {
  const registry = getProviderRegistry();
  if (!registry.has(key)) {
    throw new AppError(ErrorCode.PROVIDER_NOT_FOUND, `Provider '${key}' is not registered.`);
  }
  const descriptor = registry.list().find((entry) => entry.key === key)!;
  return { ...descriptor, available: true };
}
