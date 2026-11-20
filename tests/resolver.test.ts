import { describe, it, expect } from 'vitest';
import { SlackResolver, withRetry } from '../src/framework/resolver.js';
import { makeFakeSlack, type FakeUser } from './helpers/fake-slack.js';

describe('SlackResolver.resolveUser', () => {
  it('resolves a live human with isBot=false', async () => {
    const { client } = makeFakeSlack({ users: [{ id: 'U0FAKE0001', name: 'alice' }] });
    const r = new SlackResolver(client as never);
    expect(await r.resolveUser('U0FAKE0001')).toEqual({ id: 'U0FAKE0001', name: 'alice', isBot: false, isGuest: false });
  });

  // Slack documents non-human accounts beyond is_bot/is_app_user, some flags at the top level, some
  // on the profile, some on both; and says Slackbot has is_bot=false. Every flag, both placements.
  const FLAGS = ['is_bot', 'is_app_user', 'is_workflow_bot', 'is_agentforce_bot', 'is_sidekick_bot'];
  it.each<[string, FakeUser]>([
    ...FLAGS.flatMap((f): Array<[string, FakeUser]> => [
      [f, { id: 'U0FAKENHT1', [f]: true }],
      [`profile.${f}`, { id: 'U0FAKENHP1', profile: { [f]: true } }],
    ]),
    ['bot profile', { id: 'U0FAKEBPR1', profile: { bot_id: 'B0FAKEBPR1' } }],
    ['Slackbot', { id: 'USLACKBOT' }],
  ])('flags %s as isBot', async (_, user) => {
    const { client } = makeFakeSlack({ users: [user] });
    const r = new SlackResolver(client as never);
    expect((await r.resolveUser(user.id))?.isBot).toBe(true);
  });

  it('flags multi-channel and single-channel guests as isGuest', async () => {
    const { client } = makeFakeSlack({
      users: [
        { id: 'U0FAKEGST1', is_restricted: true },
        { id: 'U0FAKEGST2', is_ultra_restricted: true },
        { id: 'U0FAKEGST3', profile: { is_restricted: true } }, // Slack also documents profile copies
        { id: 'U0FAKEGST4', profile: { is_ultra_restricted: true } },
      ],
    });
    const r = new SlackResolver(client as never);
    for (const id of ['U0FAKEGST1', 'U0FAKEGST2', 'U0FAKEGST3', 'U0FAKEGST4']) {
      expect((await r.resolveUser(id))?.isGuest, id).toBe(true);
    }
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
