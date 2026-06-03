import type { ResolverApi, User } from './types.js';

/** Minimal read-only slice of WebClient the resolver needs. */
export interface SlackReadClient {
  users: { info(args: { user: string }): Promise<any> };
  conversations: {
    info(args: { channel: string }): Promise<any>;
    history(args: { channel: string; limit: number; oldest: string }): Promise<any>;
  };
}

/**
 * Retry transient Slack failures (429 / network). Honors err.retryAfter seconds.
 * Slack platform errors (err.data.error, e.g. channel_not_found) are permanent —
 * rethrown immediately, never retried (retrying can't succeed and posting twice
 * on a lost response is worse than failing).
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const ra = (err as { retryAfter?: number }).retryAfter;
      const rateLimited = typeof ra === 'number';
      const platformError = (err as { data?: { error?: string } }).data?.error !== undefined;
      if ((platformError && !rateLimited) || attempt >= retries) throw err;
      const waitMs = rateLimited ? ra! * 1000 : 500 * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

class BoundedCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(private readonly max: number, private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      this.map.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: string, v: V): void {
    if (this.map.size >= this.max && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { v, exp: Date.now() + this.ttlMs });
  }
}

export class SlackResolver implements ResolverApi {
  private userCache = new BoundedCache<User>(500, 10 * 60_000);
  private channelCache = new BoundedCache<string>(200, 60 * 60_000);

  constructor(private readonly client: SlackReadClient) {}

  /**
   * Resolve a user ID via users.info. Returns null for deleted users and any
   * resolution failure — validation is by API response, never by ID shape.
   */
  async resolveUser(id: string): Promise<User | null> {
    const cached = this.userCache.get(id);
    if (cached) return cached;
    let res: any;
    try {
      res = await withRetry(() => this.client.users.info({ user: id }));
    } catch {
      return null; // failures are not cached — transient errors can recover
    }
    const u = res?.user;
    if (!u || u.deleted === true) return null;
    const user: User = {
      id: u.id,
      name: u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id,
      isBot: u.is_bot === true || u.is_app_user === true,
    };
    this.userCache.set(id, user);
    return user;
  }

  async channelName(id: string): Promise<string> {
    const cached = this.channelCache.get(id);
    if (cached) return cached;
    try {
      const res = await withRetry(() => this.client.conversations.info({ channel: id }));
      const name = res?.channel?.name ?? id;
      this.channelCache.set(id, name);
      return name;
    } catch {
      return id;
    }
  }

  /**
   * Known v0.1 tradeoff: reads at most the latest 100 messages (no cursor pagination).
   * In a busier-than-100-messages/30-min channel, earlier active humans are not seen.
   * Fine at this workspace's scale; cursor pagination is roadmap if that changes.
   */
  async recentHumanUserIds(channelId: string, sinceMinutes: number, excludeUserId: string): Promise<string[]> {
    const oldest = (Date.now() / 1000 - sinceMinutes * 60).toString();
    const res = await withRetry(() =>
      this.client.conversations.history({ channel: channelId, limit: 100, oldest }),
    );
    const seen = new Set<string>();
    const out: string[] = [];
    for (const msg of (res?.messages ?? []) as Array<{ user?: string; bot_id?: string }>) {
      if (msg.bot_id || !msg.user || msg.user === excludeUserId || seen.has(msg.user)) continue;
      seen.add(msg.user);
      const u = await this.resolveUser(msg.user);
      if (u && !u.isBot) out.push(u.id);
    }
    return out;
  }
}
