import { describe, it, expect } from 'vitest';
import type { FakeUser } from './helpers/fake-slack.js';
import { welcomeHarness, BOT, NEW, WELCOME } from './helpers/welcome.js';

describe('team_join welcome', () => {
  it('full member: welcome sparkle, public welcome, explosion and DM', async () => {
    const h = welcomeHarness();
    await h.join();
    expect(h.rows()).toEqual([{ giver_id: BOT, receiver_id: NEW, reason: 'welcome' }]);
    expect(h.fake.posts.map((p) => p.channel)).toEqual(expect.arrayContaining([WELCOME, WELCOME, `D-${NEW}`]));
    expect(h.fake.posts).toHaveLength(3);
    const pub = h.fake.posts.filter((p) => p.channel === WELCOME);
    expect(pub[0]!.text.match(/<@/g)).toHaveLength(1);
    expect(pub[0]!.text).toContain(`<@${NEW}>`);
    expect(pub[1]!.text).toBe(':boom:'); // welcome, then explosion
    expect(h.dm()[0]!.text).toContain('<#C0FAKE0002>');
    expect(h.dm()[0]!.text).toContain('*dana*');
  });

  it('every post uses the text controls and has no unfilled slot', async () => {
    const h = welcomeHarness();
    await h.join();
    for (const p of h.fake.posts) {
      expect(p).toMatchObject({ parse: 'none', unfurl_links: false, unfurl_media: false });
      expect(p.text).not.toMatch(/\{\w+\}/);
    }
  });

  it.each<[string, FakeUser | null]>([
    ['bot', { id: NEW, is_bot: true }],
    ['app user', { id: NEW, is_app_user: true }],
    ['workflow bot', { id: NEW, is_workflow_bot: true }],
    ['Agentforce bot (profile flag)', { id: NEW, profile: { is_agentforce_bot: true } }],
    ['Sidekick bot (top-level flag)', { id: NEW, is_sidekick_bot: true }],
    ['multi-channel guest', { id: NEW, is_restricted: true }],
    ['single-channel guest', { id: NEW, is_ultra_restricted: true }],
    ['deleted', { id: NEW, deleted: true }],
    ['unknown', null],
  ])('%s: no posts, no row, not claimed', async (_, user) => {
    const h = welcomeHarness({ users: user ? [user] : [] });
    await h.join();
    expect(h.fake.posts).toHaveLength(0);
    expect(h.rows()).toHaveLength(0);
    expect(h.store.claimWelcome({ giverId: BOT, giverName: 'x', receiverId: NEW, receiverName: 'x', reason: 'welcome', channelId: WELCOME, channelName: 'general' })).toBe(true);
  });

  it('a repeated event welcomes once', async () => {
    const h = welcomeHarness();
    await h.join();
    await h.join();
    expect(h.fake.posts).toHaveLength(3);
    expect(h.rows()).toHaveLength(1);
  });

  it('public post fails (bot not in channel): DM still delivered, row kept, error logged', async () => {
    const h = welcomeHarness();
    h.fake.client.chat.postMessage.mockImplementation(async (args) => {
      if (args.channel === WELCOME) throw { data: { error: 'not_in_channel' } };
      h.fake.posts.push(args);
      return { ok: true };
    });
    await h.join();
    expect(h.dm()).toHaveLength(1);
    expect(h.rows()).toHaveLength(1);
    expect(h.logs.join('\n')).toContain('not_in_channel');
  });

  it('DM open fails: welcome and explosion still posted', async () => {
    const h = welcomeHarness();
    h.fake.client.conversations.open.mockRejectedValue({ data: { error: 'cannot_dm' } });
    await h.join();
    expect(h.fake.posts.map((p) => p.channel)).toEqual([WELCOME, WELCOME]);
    expect(h.logs.join('\n')).toContain('cannot_dm');
  });

  it('tour drops archived, private and missing channels', async () => {
    const h = welcomeHarness({
      tour: [
        { id: 'C0FAKE0002', about: 'ok' },
        { id: 'C0FAKE0003', about: 'archived' },
        { id: 'C0FAKE0004', about: 'private' },
        { id: 'C0FAKE0009', about: 'missing' },
      ],
    });
    await h.join();
    const text = h.dm()[0]!.text;
    expect(text).toContain('<#C0FAKE0002>');
    expect(text).not.toMatch(/C0FAKE000[349]/);
  });

  it('empty tour: no tour heading', async () => {
    const h = welcomeHarness({ tour: [] });
    await h.join();
    expect(h.dm()[0]!.text).not.toContain('A few channels');
  });

  it.each([true, false])('suggestEnabled=%s toggles the .suggest line', async (on) => {
    const h = welcomeHarness({ suggestEnabled: on });
    await h.join();
    expect(h.dm()[0]!.text.includes('.suggest')).toBe(on);
  });

  it('empty display name: greeted by real name, never by ID', async () => {
    const h = welcomeHarness({ users: [{ id: NEW, name: 'Dana Real', display_name: '' }] });
    await h.join();
    expect(h.dm()[0]!.text).toContain('*Dana Real*');
    expect(h.dm()[0]!.text).not.toContain('U0FAKE');
  });
});
