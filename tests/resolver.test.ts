import { describe, it, expect } from 'vitest';
import { SlackResolver, withRetry } from '../src/framework/resolver.js';
import { makeFakeSlack } from './helpers/fake-slack.js';

describe('SlackResolver.resolveUser', () => {
  it('resolves a live human with isBot=false', async () => {
    const { client } = makeFakeSlack({ users: [{ id: 'U0FAKE0001', name: 'alice' }] });
    const r = new SlackResolver(client as never);
    expect(await r.resolveUser('U0FAKE0001')).toEqual({ id: 'U0FAKE0001', name: 'alice', isBot: false });
  });

  it('returns null for deleted users', async () => {
    const { client } = makeFakeSlack({ users: [{ id: 'U0FAKE0001', deleted: true }] });
    const r = new SlackResolver(client as never);
    expect(await r.resolveUser('U0FAKE0001')).toBeNull();
  });

  it('returns null when resolution fails', async () => {
    const { client } = makeFakeSlack();
    const r = new SlackResolver(client as never);
    expect(await r.resolveUser('U0NOPE')).toBeNull();
  });

  it('flags bots and app users as isBot', async () => {
    const { client } = makeFakeSlack({
      users: [
        { id: 'B0FAKEBOT1', is_bot: true },
        { id: 'U0FAKEAPP1', is_app_user: true },
      ],
    });
    const r = new SlackResolver(client as never);
    expect((await r.resolveUser('B0FAKEBOT1'))?.isBot).toBe(true);
    expect((await r.resolveUser('U0FAKEAPP1'))?.isBot).toBe(true);
  });

  it('caches lookups', async () => {
    const { client } = makeFakeSlack({ users: [{ id: 'U0FAKE0001', name: 'alice' }] });
    const r = new SlackResolver(client as never);
    await r.resolveUser('U0FAKE0001');
    await r.resolveUser('U0FAKE0001');
    expect(client.users.info).toHaveBeenCalledTimes(1);
  });
});

describe('recentHumanUserIds', () => {
  it('dedupes, excludes giver/bots/deleted, resolves each user', async () => {
    const { client } = makeFakeSlack({
      users: [
        { id: 'U0FAKE0002', name: 'bob' },
        { id: 'U0FAKE0003', name: 'carol' },
        { id: 'U0FAKEDEAD', deleted: true },
      ],
      history: [
        { user: 'U0FAKE0002' },
        { user: 'U0FAKE0002' },          // dup
        { user: 'U0FAKE0001' },          // giver, excluded
        { bot_id: 'B0FAKEBOT1' },        // bot message, excluded
        { user: 'U0FAKE0003' },
        { user: 'U0FAKEDEAD' },          // deleted, excluded post-resolution
      ],
    });
    const r = new SlackResolver(client as never);
    const ids = await r.recentHumanUserIds('C0FAKE0001', 30, 'U0FAKE0001');
    expect(ids).toEqual(['U0FAKE0002', 'U0FAKE0003']);
  });
});

describe('withRetry', () => {
  it('retries transient failures then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) { const e: any = new Error('rate_limited'); e.retryAfter = 0; throw e; }
      return 'ok';
    }, 2);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries', async () => {
    await expect(withRetry(async () => { const e: any = new Error('boom'); e.retryAfter = 0; throw e; }, 1))
      .rejects.toThrow('boom');
  });

  it('retries a rate-limited platform error before abandoning', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) {
        const e: any = new Error('rate_limited');
        e.data = { error: 'too_many_requests' }; // platform error struct
        e.retryAfter = 0;
        throw e;
      }
      return 'ok';
    }, 2);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
});
