import { describe, it, expect, beforeEach } from 'vitest';
import { createDispatcher } from '../src/framework/dispatcher.js';
import { Registry } from '../src/framework/registry.js';
import { SlackResolver } from '../src/framework/resolver.js';
import { SlidingWindow } from '../src/framework/rate-limit.js';
import { createSqliteStore } from '../src/store/sqlite.js';
import { AccessLevel, type Command, type Context } from '../src/framework/types.js';
import { trusted } from '../src/framework/safe.js';
import { makeFakeSlack } from './helpers/fake-slack.js';

const BOT = 'U0FAKEBOT9';
const GIVER = { id: 'U0FAKE0001', name: 'alice' };
const TARGET = { id: 'U0FAKE0002', name: 'bob' };


function harness(commandOverrides: Partial<Command> = {}, opts: { commandLimit?: number; ownerId?: string } = {}) {
  const fake = makeFakeSlack({
    users: [
      GIVER, TARGET,
      { id: 'U0FAKE0003', name: 'carol' },
      // Filler humans so boundary tests can hit MAX_TARGETS exactly.
      ...Array.from({ length: 8 }, (_, i) => ({ id: `U0FAKE001${i + 1}`, name: `filler${i + 1}` })),
      { id: 'B0FAKEBOT1', name: 'otherbot', is_bot: true },
      { id: 'U0FAKEAPP1', name: 'cadence', is_app_user: true },
      { id: 'U0FAKEDEAD', name: 'ghost', deleted: true },
      { id: BOT, name: 'sparklebot', is_bot: true },
    ],
    channels: { C0FAKE0001: 'general' },
    botUserId: BOT,
  });
  const runs: Context[] = [];
  const cmd: Command = {
    name: () => 'sparkle',
    aliases: () => [],
    help: () => '`.sparkle @user`',
    access: () => AccessLevel.Everyone,
    takesTargets: () => true,
    subcommands: () => ['party'],
    run: async (ctx) => { runs.push(ctx); },
    ...commandOverrides,
  };
  const registry = new Registry();
  registry.register(cmd);
  const store = createSqliteStore(':memory:');
  const dispatch = createDispatcher({
    registry,
    resolver: new SlackResolver(fake.client as never),
    store,
    rateLimiter: new SlidingWindow(10, 60_000, () => 0),
    commandLimiter: new SlidingWindow(opts.commandLimit ?? 20, 60_000, () => 0),
    botUserId: BOT,
    client: fake.client as never,
    log: () => {},
    ownerId: opts.ownerId,
  });
  // Each call gets a unique ts (like real Slack messages); pass an explicit ts to
  // simulate a redelivery of the same message.
  let tsCounter = 0;
  const msg = function(text: string, user?: string, ts?: string, extra: Record<string, unknown> = {}) {
    const m: any = { type: 'message', text, channel: 'C0FAKE0001', ts: ts ?? `1.${++tsCounter}`, ...extra };
    if (arguments.length === 1) {
      m.user = GIVER.id;
    } else if (user !== undefined) {
      m.user = user;
    }
    // else: arguments.length > 1 && user === undefined → no user field
    if (process.env.DEBUG_DISPATCHER) console.log('HARNESS: msg() created message:', JSON.stringify(m));
    return dispatch({ message: m });
  };
  return { fake, runs, msg, store, dispatch };
}

describe('dispatcher routing', () => {
  it('runs a known command with resolved mentions and reason', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002> great work');
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]!.mentions).toEqual([{ id: 'U0FAKE0002', name: 'bob', isBot: false, isGuest: false }]);
    expect(h.runs[0]!.args).toBe('great work');
    expect(h.runs[0]!.giver.id).toBe(GIVER.id);
  });

  it('ignores unknown commands and non-dot messages', async () => {
    const h = harness();
    await h.msg('.unknown hi');
    await h.msg('hello world');
    expect(h.runs).toHaveLength(0);
    expect(h.fake.posts).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(0);
  });

  it('ignores bot-authored messages (subtype/bot_id)', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002>', undefined as never); // no user field
    expect(h.runs).toHaveLength(0);
  });

  it('dedupes repeated mentions on resolved ID', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002> <@U0FAKE0002> thanks');
    expect(h.runs[0]!.mentions).toHaveLength(1);
  });

  it('routes subcommand without target resolution', async () => {
    const h = harness();
    await h.msg('.sparkle party');
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]!.mentions).toEqual([]);
    expect(h.runs[0]!.args).toBe('party');
  });

  // Codex finding: Bolt redelivers a message when the ack is slow or Socket Mode
  // reconnects mid-delivery. The same channel+ts must never run a command twice.
  it('runs a redelivered message (same channel+ts) only once', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002> great work', GIVER.id, '1717400000.000100');
    await h.msg('.sparkle <@U0FAKE0002> great work', GIVER.id, '1717400000.000100');
    expect(h.runs).toHaveLength(1);
  });

  it('accepts exactly MAX_TARGETS (10) mentions', async () => {
    const h = harness();
    const ten = ['U0FAKE0002', 'U0FAKE0003', ...Array.from({ length: 8 }, (_, i) => `U0FAKE001${i + 1}`)];
    await h.msg(`.sparkle ${ten.map((id) => `<@${id}>`).join(' ')} team effort`);
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]!.mentions).toHaveLength(10);
  });

  it('accepts a reason of exactly 256 chars and rejects 257', async () => {
    const h = harness();
    await h.msg(`.sparkle <@U0FAKE0002> ${'a'.repeat(256)}`);
    expect(h.runs).toHaveLength(1);
    await h.msg(`.sparkle <@U0FAKE0002> ${'a'.repeat(257)}`);
    expect(h.runs).toHaveLength(1); // second did not run
    expect(h.fake.ephemerals.at(-1)!.text).toContain('Reason too long');
  });

  it('unresolvable target mid-list: command never runs, no partial awards', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002> <@U0FAKE9999> <@U0FAKE0003> thanks all');
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(1);
    expect(h.fake.ephemerals[0]!.text).toContain("Couldn't resolve");
  });

  it('rejects a huge non-mention token quickly without hanging', async () => {
    const h = harness();
    const start = Date.now();
    await h.msg(`.sparkle ${'x'.repeat(5000)}`);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals[0]!.text).toContain('real @-mention');
  });

  it('ignores thread_broadcast and message_changed subtypes', async () => {
    const h = harness();
    for (const subtype of ['thread_broadcast', 'message_changed']) {
      await h.dispatch({
        message: {
          type: 'message', subtype, text: '.sparkle <@U0FAKE0002> edited in',
          user: GIVER.id, channel: 'C0FAKE0001', ts: `9.${subtype.length}`,
        } as never,
      });
    }
    expect(h.runs).toHaveLength(0);
    expect(h.fake.posts).toHaveLength(0);
  });

  it('claims the message before validation: redelivered invalid message replies once', async () => {
    const h = harness();
    // Bot giver fails the human gate, but the redelivery is dropped at the dedup
    // claim — only one "Only humans" ephemeral ever goes out.
    await h.msg('.sparkle <@U0FAKE0002> nice', 'B0FAKEBOT1', '1717400000.000300');
    await h.msg('.sparkle <@U0FAKE0002> nice', 'B0FAKEBOT1', '1717400000.000300');
    expect(h.fake.ephemerals).toHaveLength(1);
  });

  // Codex finding: own-bot quips and non-award commands (.sparkles DM spam) had no
  // throttle — award budget only charges awardable targets. A second, framework-level
  // limiter charges EVERY recognized command invocation, so future commands are
  // covered without their authors remembering ctx.rate.
  it('throttles total command invocations per user, separate from award budget', async () => {
    const h = harness({}, { commandLimit: 3 });
    for (let i = 0; i < 3; i++) await h.msg(`.sparkle <@${BOT}> nice bot`); // uncharged quips
    expect(h.runs).toHaveLength(3);
    await h.msg(`.sparkle <@${BOT}> nice bot`); // 4th invocation
    expect(h.runs).toHaveLength(3); // throttled before run
    expect(h.fake.ephemerals.at(-1)!.text).toMatch(/slow down/i);
  });

  it('command throttle is per-user', async () => {
    const h = harness({}, { commandLimit: 1 });
    await h.msg('.sparkle <@U0FAKE0002> one');
    await h.msg('.sparkle <@U0FAKE0003> two', 'U0FAKE0002'); // different giver, own budget
    expect(h.runs).toHaveLength(2);
  });

  it('`.{cmd} help` replies the command help ephemerally without running it', async () => {
    const h = harness();
    await h.msg('.sparkle help');
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(1);
    expect(h.fake.ephemerals[0]!.text).toContain('.sparkle @user');
  });
});

describe('giver gate (deny-by-default)', () => {
  it('rejects a bot giver', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002>', 'B0FAKEBOT1');
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(1);
    expect(h.fake.ephemerals[0]!.text).toMatch(/human/i);
  });

  it('rejects an app-user giver (proxy app)', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002>', 'U0FAKEAPP1');
    expect(h.runs).toHaveLength(0);
  });

  it('rejects an unresolvable giver', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002>', 'U0NOTREAL');
    expect(h.runs).toHaveLength(0);
  });
});

describe('target resolution rejects (named ephemeral, no silent drops)', () => {
  it('rejects broadcast tags anywhere in args', async () => {
    const h = harness();
    await h.msg('.sparkle <!here>');
    await h.msg('.sparkle <@U0FAKE0002> nice <!channel>');
    await h.msg('.sparkle <!subteam^S0FAKE001>');
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(3);
  });

  it('rejects bare text / raw-ID targets', async () => {
    const h = harness();
    await h.msg('.sparkle bob');
    await h.msg('.sparkle U0FAKE0002');
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(2);
    expect(h.fake.ephemerals[0]!.text).toMatch(/@-mention/i);
  });

  it('rejects deleted and unresolvable users', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKEDEAD>');
    await h.msg('.sparkle <@U0GONE9999>');
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(2);
  });

  it('rejects a mention smuggled into the reason text', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002> thanks to <@U0FAKE0003> too');
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(1);
    expect(h.fake.ephemerals[0]!.text).toMatch(/before the reason/i);
  });

  it('rejects other bots/apps as targets but allows our own bot through', async () => {
    const h = harness();
    await h.msg('.sparkle <@B0FAKEBOT1>');
    expect(h.runs).toHaveLength(0);
    await h.msg(`.sparkle <@${BOT}>`);
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]!.mentions[0]!.isBot).toBe(true);
  });
});

describe('caps + rate middleware', () => {
  it('rejects > 10 targets', async () => {
    const mentions = Array.from({ length: 11 }, (_, i) => `<@U0FAKE00${String(i).padStart(2, '0')}>`).join(' ');
    const h = harness();
    await h.msg(`.sparkle ${mentions}`);
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals[0]!.text).toMatch(/10/);
  });

  it('rejects reason > 256 chars', async () => {
    const h = harness();
    await h.msg(`.sparkle <@U0FAKE0002> ${'x'.repeat(300)}`);
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals[0]!.text).toMatch(/256/);
  });

  it('charges the rate window per awardable target and rejects past the cap', async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) await h.msg('.sparkle <@U0FAKE0002> go');
    expect(h.runs).toHaveLength(10);
    await h.msg('.sparkle <@U0FAKE0003> over');
    expect(h.runs).toHaveLength(10); // 11th rejected
    expect(h.fake.ephemerals.at(-1)!.text).toMatch(/rate|slow/i);
  });

  it('does not charge for self or own-bot targets', async () => {
    const h = harness();
    for (let i = 0; i < 12; i++) await h.msg(`.sparkle <@${GIVER.id}> me again`);
    expect(h.runs).toHaveLength(12); // self-target never rate-limited at framework level
  });
});

describe('context output boundary', () => {
  it('reply posts SafeText.text to the channel', async () => {
    const h = harness({
      run: async (ctx) => {
        const { fmt } = await import('../src/framework/safe.js');
        await ctx.reply(fmt`hi ${'<!here>'}`);
      },
    });
    await h.msg('.sparkle <@U0FAKE0002>');
    expect(h.fake.posts[0]!.text).toBe('hi &lt;!here&gt;');
    expect(h.fake.posts[0]!).toMatchObject({
      parse: 'none',
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('replyEphemeral posts SafeText.text with Slack parsing controls', async () => {
    const h = harness({
      run: async (ctx) => {
        const { fmt } = await import('../src/framework/safe.js');
        await ctx.replyEphemeral(fmt`see ${'https://example.com'}`);
      },
    });
    await h.msg('.sparkle <@U0FAKE0002>');
    expect(h.fake.ephemerals[0]!).toMatchObject({
      text: 'see `https://example.com`',
      parse: 'none',
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('replyDM posts SafeText.text with Slack parsing controls', async () => {
    const h = harness({
      run: async (ctx) => {
        const { fmt } = await import('../src/framework/safe.js');
        await ctx.replyDM(fmt`dm ${'https://example.com'}`);
      },
    });
    await h.msg('.sparkle <@U0FAKE0002>');
    expect(h.fake.posts[0]!).toMatchObject({
      channel: `D-${GIVER.id}`,
      text: 'dm `https://example.com`',
      parse: 'none',
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it('replyDM fallback ephemeral keeps Slack parsing controls', async () => {
    const h = harness({
      run: async (ctx) => {
        const { fmt } = await import('../src/framework/safe.js');
        await ctx.replyDM(fmt`fallback ${'https://example.com'}`);
      },
    });
    h.fake.client.conversations.open.mockRejectedValue(new Error('dm_closed') as never);
    await h.msg('.sparkle <@U0FAKE0002>');
    expect(h.fake.ephemerals[0]!).toMatchObject({
      text: 'fallback `https://example.com`',
      parse: 'none',
      unfurl_links: false,
      unfurl_media: false,
    });
  });
});

describe('notifyOwner', () => {
  it('DMs the configured owner, and returns false with no owner', async () => {
    const results: boolean[] = [];
    const run = async (ctx: Context) => { results.push(await ctx.notifyOwner(trusted('an idea'))); };
    const h = harness({ run }, { ownerId: 'U0FAKE0003' });
    await h.msg('.sparkle party');
    expect(results).toEqual([true]);
    expect(h.fake.posts).toEqual([{ channel: 'D-U0FAKE0003', text: 'an idea', parse: 'none', unfurl_links: false, unfurl_media: false }]);

    const none = harness({ run });
    await none.msg('.sparkle party');
    expect(results).toEqual([true, false]);
    expect(none.fake.posts).toHaveLength(0);
  });

  it('returns false when the DM fails', async () => {
    const results: boolean[] = [];
    const h = harness({ run: async (ctx) => { results.push(await ctx.notifyOwner(trusted('x'))); } }, { ownerId: 'U0FAKE0003' });
    h.fake.client.conversations.open.mockRejectedValue({ data: { error: 'user_not_found' } });
    await h.msg('.sparkle party');
    expect(results).toEqual([false]);
  });

  it('rejects a forged non-SafeText message', async () => {
    const h = harness({}, { ownerId: 'U0FAKE0003' });
    await h.msg('.sparkle party');
    await expect(h.runs[0]!.notifyOwner({ text: '<!channel>' } as never)).rejects.toThrow();
    expect(h.fake.posts).toHaveLength(0);
  });
});

describe('messages sent through an app (AI agents)', () => {
  const APP = { bot_id: 'B0FAKEAGT1', app_id: 'A0FAKEAGT1' };

  it('a human sending through an agent runs the command, marked viaAgent', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002> thanks', GIVER.id, undefined, APP);
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]!.viaAgent).toBe(true);
    expect(h.runs[0]!.giver.id).toBe(GIVER.id);
  });

  it.each([{ bot_id: 'B0FAKEAGT1' }, { app_id: 'A0FAKEAGT1' }, { bot_profile: { name: 'agent' } }])(
    'any one attribution field marks viaAgent (%o)', async (extra) => {
      const h = harness();
      await h.msg('.sparkle <@U0FAKE0002>', GIVER.id, undefined, extra);
      expect(h.runs[0]!.viaAgent).toBe(true);
    });

  it('a message typed by the human is not viaAgent', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002>');
    expect(h.runs[0]!.viaAgent).toBe(false);
  });

  it('an app posting as itself is dropped silently', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002>', 'B0FAKEBOT1', undefined, APP);
    await h.msg('.sparkle <@U0FAKE0002>', 'U0FAKEAPP1', undefined, APP);
    expect(h.runs).toHaveLength(0);
    expect(h.fake.ephemerals).toHaveLength(0);
    expect(h.fake.posts).toHaveLength(0);
  });

  it('subtyped messages are still ignored even from a human', async () => {
    const h = harness();
    await h.msg('.sparkle <@U0FAKE0002>', GIVER.id, undefined, { ...APP, subtype: 'bot_message' });
    expect(h.runs).toHaveLength(0);
  });
});
