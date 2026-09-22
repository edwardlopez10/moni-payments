export interface SecretsProvider {
  readonly schemes: readonly string[];
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
