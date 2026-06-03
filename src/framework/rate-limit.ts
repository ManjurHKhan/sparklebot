type Clock = () => number;

// Memory note: both classes hold per-key in-memory Maps with no eviction. Bounded in
// practice by (users × channels) at this workspace's scale, and a restart clears state.
// Known single-replica tradeoff; an HA rollout would move this to shared storage.

/** Per-key sliding-window counter. tryConsume(key, n) atomically checks-and-charges. */
export class SlidingWindow {
  private events = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: Clock = Date.now,
  ) {}

  tryConsume(key: string, n = 1): boolean {
    const t = this.now();
    const cutoff = t - this.windowMs;
    const list = (this.events.get(key) ?? []).filter((ts) => ts > cutoff);
    if (list.length + n > this.limit) {
      this.events.set(key, list);
      return false;
    }
    for (let i = 0; i < n; i++) list.push(t);
    this.events.set(key, list);
    return true;
  }
}

/** Per-key cooldown gate. try(key) returns true and records when allowed. */
export class Cooldown {
  private last = new Map<string, number>();

  constructor(
    private readonly ms: number,
    private readonly now: Clock = Date.now,
  ) {}

  try(key: string): boolean {
    const t = this.now();
    const prev = this.last.get(key);
    if (prev !== undefined && t - prev < this.ms) return false;
    this.last.set(key, t);
    return true;
  }
}
