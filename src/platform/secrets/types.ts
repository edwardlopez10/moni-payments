export interface SecretWriteOptions {
  /** Forwarded to Secrets Manager as ClientRequestToken when present. */
  clientRequestToken?: string;
  /** Classifies the audit row. The store write is still a put of the same reference. */
  auditOperation?: 'put' | 'rotation';
}

export interface SecretsProvider {
  readonly schemes: readonly string[];
  put<T>(reference: string, value: T, options?: SecretWriteOptions): Promise<void>;
  get<T>(reference: string): Promise<T>;
  delete(reference: string): Promise<void>;
  exists(reference: string): Promise<boolean>;
  /**
   * @deprecated Prefer {@link SecretsProvider.get}. Temporary migration bridge until callers
   * are updated (spec T-010). Returns a string; non-string stored values are JSON-stringified.
   */
  resolve(reference: string): Promise<string>;
}

export function parseSecretReference(
  reference: string,
): { scheme: string; locator: string } | null {
  const match = /^([a-z0-9]+):\/\/(.+)$/i.exec(reference.trim());
  if (!match) {
    return null;
  }
  const scheme = match[1]?.toLowerCase();
  const locator = match[2];
  if (!scheme || !locator) {
    return null;
  }
  return { scheme, locator };
}

/** Coerce a stored secret value to the string shape expected by legacy `resolve` callers. */
export function secretValueAsString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}
