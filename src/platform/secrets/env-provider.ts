import { AppError, ErrorCode } from '../../domain/errors';
import { parseSecretReference, type SecretsProvider } from './types';

export class EnvSecretsProvider implements SecretsProvider {
  readonly schemes = ['env'] as const;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(reference: string): Promise<string> {
    const parsed = parseSecretReference(reference);
    if (!parsed || parsed.scheme !== 'env') {
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        'Invalid secret reference scheme.',
      );
    }

    const value = this.env[parsed.locator];
    if (value === undefined || value === '') {
      // Do not include the resolved value (there is none) or env contents in the message.
      throw new AppError(
        ErrorCode.PROVIDER_CONFIGURATION_ERROR,
        `Secret reference could not be resolved (${parsed.locator}).`,
      );
    }

    return value;
  }
}
