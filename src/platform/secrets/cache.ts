/**
 * In-process secret cache. Values stay on the heap, are never logged here, and are
 * dropped as soon as their TTL elapses — expired entries are not served during an outage.
 */
export class SecretValueCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 256,
  ) {
    if (ttlMs <= 0 || ttlMs > 60_000) {
      throw new Error('Secret cache TTL must be between 1ms and 60000ms.');
    }
  }

  get(reference: string, now: number): unknown | undefined {
    const entry = this.entries.get(reference);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= now) {
      this.entries.delete(reference);
      return undefined;
    }
    return entry.value;
  }

  set(reference: string, value: unknown, now: number): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(reference)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(reference, { value, expiresAt: now + this.ttlMs });
  }

  invalidate(reference: string): void {
    this.entries.delete(reference);
  }
}
