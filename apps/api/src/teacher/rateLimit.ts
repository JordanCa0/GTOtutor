/** Sliding one-hour window per client key; only charged for cache misses (real Claude calls). */
export class HourlyRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryConsume(key: string): boolean {
    const cutoff = this.now() - 60 * 60 * 1000;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    return true;
  }
}
