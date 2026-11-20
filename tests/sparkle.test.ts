import { describe, it, expect } from 'vitest';
import { createSparkleCommand } from '../src/commands/sparkle.js';
import { tierEmoji } from '../src/commands/sparkle.js';
import { createMessages } from '../src/messages.js';
import { Cooldown } from '../src/framework/rate-limit.js';
import { emojiBurst, type SafeText } from '../src/framework/safe.js';
import { makeCtx, GIVER, BOT } from './helpers/ctx.js';
import type { User } from '../src/framework/types.js';
import type { Store } from '../src/store/store.js';

const BOB: User = { id: 'U0FAKE0002', name: 'bob', isBot: false };
const OWN_BOT: User = { id: BOT, name: 'sparklebot', isBot: true };

function cmd() {
  return createSparkleCommand({
    messages: createMessages('playful'),
    config: { currency: 'sparkle', currencyPlural: 'sparkles', partyMinutes: 30, partyMaxRecipients: 10 },
    partyChannelCooldown: new Cooldown(300_000, () => 0),
    partyGiverCooldown: new Cooldown(1_800_000, () => 0),
    megaBurst: emojiBurst(':boom:'),
  });
}

const booms = (replies: string[]) => replies.filter((r) => r === ':boom:').length;

/** n sparkles to `receiver` from a third party. */
function seed(store: Store, receiver: string, n: number) {
  store.insertSparkles(Array.from({ length: n }, () => ({
    giverId: 'U0FAKE0098', giverName: 'seed', receiverId: receiver, receiverName: 'x',
    reason: null, channelId: 'C0FAKE0001', channelName: 'general',
  })));
}

/** An earlier give by GIVER, so the first-give bonus can't mask a missing milestone. */
function seedPriorGive(store: Store) {
  store.insertSparkles([{
    giverId: GIVER.id, giverName: GIVER.name, receiverId: 'U0FAKE0099', receiverName: 'x',
    reason: null, channelId: 'C0FAKE0001', channelName: 'general',
  }]);
}

describe('tierEmoji', () => {
  it('maps thresholds', () => {
    expect(tierEmoji(1)).toBe(':sparkles:');
    expect(tierEmoji(5)).toBe(':star:');
    expect(tierEmoji(10)).toBe(':sparkle:');
    expect(tierEmoji(25)).toBe(':dizzy:');
    expect(tierEmoji(50)).toBe(':star2:');
    expect(tierEmoji(100)).toBe(':gem:');
  });
});

describe('.sparkle human target', () => {
  it('records the sparkle and posts bold names + count', async () => {
    const h = makeCtx({ mentions: [BOB], args: 'for shipping the fix' });
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived(BOB.id)).toBe(1);
    expect(h.replies).toHaveLength(3); // award + first-give bonus + explosion
    expect(h.replies[0]).toContain('*bob*');
    expect(h.replies[0]).toContain('shipping the fix'); // "for" prefix normalized away
  });

  it('first sparkle gets a celebration', async () => {
    const h = makeCtx({ mentions: [BOB] });
    await cmd().run(h.ctx);
    // celebration templates come from personality firstSparkleCelebration pool
    expect(h.replies[0]!.length).toBeGreaterThan(0);
    expect(h.store.isFirstSparkle(BOB.id)).toBe(false);
  });

  it('multi-target inserts atomically and posts per target', async () => {
    const CAROL: User = { id: 'U0FAKE0003', name: 'carol', isBot: false };
    const h = makeCtx({ mentions: [BOB, CAROL], args: 'teamwork' });
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived(BOB.id)).toBe(1);
    expect(h.store.getTotalReceived(CAROL.id)).toBe(1);
    expect(h.replies).toHaveLength(4); // 2 awards + first-give bonus + explosion
  });

  it('with no mentions replies ephemeral usage', async () => {
    const h = makeCtx({ mentions: [], args: '' });
    await cmd().run(h.ctx);
    expect(h.ephemerals).toHaveLength(1);
    expect(h.store.getLeaderboard(10)).toHaveLength(0);
  });
});

describe('.sparkle disposition', () => {
  it('own bot target → quip only, no DB write', async () => {
    const h = makeCtx({ mentions: [OWN_BOT] });
    await cmd().run(h.ctx);
    expect(h.replies).toHaveLength(1);
    expect(h.store.getTotalReceived(BOT)).toBe(0);
  });

  it('mixed bot+self+human in one command: quip + self path + award all fire', async () => {
    const self: User = { ...GIVER };
    const h = makeCtx({ mentions: [OWN_BOT, self, BOB], args: 'for everything' });
    await cmd().run(h.ctx);
    expect(h.replies).toHaveLength(5); // quip, first-self celebration, bob award, first-give bonus, explosion
    expect(h.store.getTotalReceived(BOT)).toBe(0); // bot never gets a ledger row
    expect(h.store.getTotalReceived(GIVER.id)).toBe(2); // one-time self gag row + first-give bonus
    expect(h.store.getTotalReceived(BOB.id)).toBe(1); // real award
  });

  it('self target: first time records + celebrates, then shames in channel, then goes ephemeral past cap', async () => {
    const self: User = { ...GIVER };
    const c = cmd();
    const h = makeCtx({ mentions: [self] });
    await c.run(h.ctx);                       // attempt 1: allowed
    expect(h.store.getTotalReceived(GIVER.id)).toBe(1);
    for (let i = 2; i <= 5; i++) await c.run(h.ctx); // attempts 2-5: channel shame
    expect(h.store.getTotalReceived(GIVER.id)).toBe(1); // still only 1
    expect(h.replies).toHaveLength(5);
    await c.run(h.ctx);                       // attempt 6: past cap → ephemeral
    expect(h.replies).toHaveLength(5);
    expect(h.ephemerals).toHaveLength(1);
  });
});

describe('.sparkle party', () => {
  function partyHarness(activeIds: string[], rateOk = true) {
    const h = makeCtx({
      args: 'party',
      resolver: {
        resolveUser: async (id) => ({ id, name: `name-${id}`, isBot: false }),
        channelName: async () => 'general',
        recentHumanUserIds: async () => activeIds,
      },
      rate: { tryConsume: () => rateOk },
    });
    return h;
  }

  // Codex finding: `.sparkle party @alice` silently ignored the mention and sparkled
  // recent posters instead — surprising side effects. Party takes no targets; trailing
  // args with a mention must be rejected with a named reason, before any cooldown burns.
  it('rejects trailing mentions after party without burning cooldowns', async () => {
    const h = makeCtx({
      args: 'party <@U0FAKE0002>',
      resolver: {
        resolveUser: async (id) => ({ id, name: `name-${id}`, isBot: false }),
        channelName: async () => 'general',
        recentHumanUserIds: async () => ['U0FAKE0003'],
      },
    });
    const c = cmd(); // same instance across both runs so cooldown state carries over
    await c.run(h.ctx);
    expect(h.store.getLeaderboard(10)).toHaveLength(0);
    expect(h.ephemerals).toHaveLength(1);
    expect(h.ephemerals[0]).toContain("doesn't take targets");
    // Cooldowns untouched: an immediate valid party from the same giver+channel still works.
    const h2 = partyHarness(['U0FAKE0003']);
    await c.run(h2.ctx);
    expect(h2.store.getTotalReceived('U0FAKE0003')).toBe(1);
  });

  it('awards everyone active, atomically, and announces once', async () => {
    const h = partyHarness(['U0FAKE0002', 'U0FAKE0003']);
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived('U0FAKE0002')).toBe(1);
    expect(h.store.getTotalReceived('U0FAKE0003')).toBe(1);
    expect(h.replies).toHaveLength(3); // announcement + first-give bonus + explosion
  });

  it('caps recipients at 10', async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `U0FAKE${String(100 + i)}`);
    const h = partyHarness(ids);
    await cmd().run(h.ctx);
    const total = ids.reduce((acc, id) => acc + h.store.getTotalReceived(id), 0);
    expect(total).toBe(10);
  });

  it('rejects when the rate window cannot cover the recipients', async () => {
    const h = partyHarness(['U0FAKE0002'], false);
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived('U0FAKE0002')).toBe(0);
    expect(h.ephemerals).toHaveLength(1);
  });

  it('enforces per-channel and cross-channel cooldowns', async () => {
    let t = 0;
    const c = createSparkleCommand({
      messages: createMessages('playful'),
      config: { currency: 'sparkle', currencyPlural: 'sparkles', partyMinutes: 30, partyMaxRecipients: 10 },
      partyChannelCooldown: new Cooldown(300_000, () => t),
      partyGiverCooldown: new Cooldown(1_800_000, () => t),
      megaBurst: emojiBurst(':boom:'),
    });
    const h1 = partyHarness(['U0FAKE0002']);
    await c.run(h1.ctx);
    expect(h1.replies).toHaveLength(3); // announcement + first-give bonus + explosion

    // Same channel, 4 min later → blocked by channel cooldown.
    t = 240_000;
    const h2 = partyHarness(['U0FAKE0002']);
    await c.run(h2.ctx);
    expect(h2.ephemerals).toHaveLength(1);
    expect(h2.replies).toHaveLength(0);

    // Different channel, 10 min later → still blocked by cross-channel giver cooldown.
    t = 600_000;
    const h3 = partyHarness(['U0FAKE0002']);
    h3.ctx.channel.id = 'C0FAKE0002';
    await c.run(h3.ctx);
    expect(h3.ephemerals).toHaveLength(1);

    // 31 min later → allowed again.
    t = 1_860_000;
    const h4 = partyHarness(['U0FAKE0002']);
    h4.ctx.channel.id = 'C0FAKE0002';
    await c.run(h4.ctx);
    expect(h4.replies).toHaveLength(3); // fresh store: announcement + first-give bonus + explosion
  });

  it('replies when no one is active', async () => {
    const h = partyHarness([]);
    await cmd().run(h.ctx);
    expect(h.replies[0]).toMatch(/no one/i);
    expect(h.store.getLeaderboard(10)).toHaveLength(0);
  });
});

const CAROL: User = { id: 'U0FAKE0003', name: 'carol', isBot: false };

function partyOf(activeIds: string[], isBot = false) {
  return makeCtx({
    args: 'party',
    resolver: {
      resolveUser: async (id) => ({ id, name: `name-${id}`, isBot }),
      channelName: async () => 'general',
      recentHumanUserIds: async () => activeIds,
    },
  });
}

describe('mega explosion', () => {
  it('explodes once on first sparkle received', async () => {
    const h = makeCtx({ mentions: [BOB] });
    seedPriorGive(h.store);
    await cmd().run(h.ctx);
    expect(booms(h.replies)).toBe(1);
    expect(h.replies.at(-1)).toBe(':boom:'); // after the award message
  });

  it('explodes when reaching 5 and 100', async () => {
    const h = makeCtx({ mentions: [BOB] });
    seedPriorGive(h.store);
    seed(h.store, BOB.id, 4);
    await cmd().run(h.ctx); // 5
    expect(booms(h.replies)).toBe(1);
    seed(h.store, BOB.id, 94);
    await cmd().run(h.ctx); // 100
    expect(h.store.getTotalReceived(BOB.id)).toBe(100);
    expect(booms(h.replies)).toBe(2);
  });

  it('no explosion at 2 or 6', async () => {
    const h = makeCtx({ mentions: [BOB] });
    seedPriorGive(h.store);
    seed(h.store, BOB.id, 1);
    await cmd().run(h.ctx); // 2
    seed(h.store, BOB.id, 3);
    await cmd().run(h.ctx); // 6
    expect(h.store.getTotalReceived(BOB.id)).toBe(6);
    expect(booms(h.replies)).toBe(0);
  });

  it('no explosion for self-sparkle or bot quip', async () => {
    const h = makeCtx({ mentions: [OWN_BOT] });
    await cmd().run(h.ctx);
    const self = makeCtx({ mentions: [{ ...GIVER }] }); // first self-sparkle: total 1, still no explosion
    await cmd().run(self.ctx);
    expect(self.store.getTotalReceived(GIVER.id)).toBe(1);
    expect(booms(h.replies) + booms(self.replies)).toBe(0);
  });

  it('party with three milestone crossings explodes once', async () => {
    const h = partyOf(['U0FAKE0002', 'U0FAKE0003', 'U0FAKE0004']);
    seedPriorGive(h.store);
    await cmd().run(h.ctx);
    expect(booms(h.replies)).toBe(1);
    expect(h.replies).toHaveLength(2); // announcement + explosion
  });

  it('milestone reached while an earlier reply is blocked still explodes', async () => {
    const base = makeCtx();
    const store = base.store;
    seedPriorGive(store);
    seed(store, BOB.id, 1);   // BOB: 1 -> 2, no milestone
    seed(store, CAROL.id, 4); // CAROL: 4 -> 5, milestone
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const replies: string[] = [];
    let blocked = true;
    const run1 = makeCtx({
      store, mentions: [BOB, CAROL],
      reply: async (m: SafeText) => {
        if (blocked) { blocked = false; await gate; }
        replies.push(m.text);
      },
    });
    const c = cmd();
    const p1 = c.run(run1.ctx);
    // A second command bumps CAROL past 5 while run1's first reply is still pending.
    const run2 = makeCtx({ store, mentions: [CAROL] });
    await c.run(run2.ctx);
    expect(store.getTotalReceived(CAROL.id)).toBe(6);
    release();
    await p1;
    expect(booms(replies)).toBe(1);
    expect(replies.some((r) => r.includes('*carol* now has *5*'))).toBe(true);
  });
});

describe('first-give bonus', () => {
  it('first give gives the giver one sparkle from the bot', async () => {
    const h = makeCtx({ mentions: [BOB] });
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived(GIVER.id)).toBe(1);
    expect(h.store.hasGivenToOthers(BOT)).toBe(true); // the bonus row's giver is the bot
    expect(h.replies[1]).toContain('*alice*');
    expect(h.replies[2]).toBe(':boom:'); // bonus message comes before the explosion
  });

  it('second give gives no bonus', async () => {
    const h = makeCtx({ mentions: [BOB] });
    await cmd().run(h.ctx);
    const before = h.replies.length;
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived(GIVER.id)).toBe(1);
    expect(h.replies.length - before).toBe(1); // just the award; BOB at 2 is no milestone
  });

  it('self-sparkle first, then a real give, still gives the bonus', async () => {
    const h = makeCtx({ mentions: [{ ...GIVER }] });
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived(GIVER.id)).toBe(1);
    h.ctx.mentions = [BOB];
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived(GIVER.id)).toBe(2);
  });

  it('party first give gives the bonus', async () => {
    const h = partyOf(['U0FAKE0002']);
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived(GIVER.id)).toBe(1);
    expect(booms(h.replies)).toBe(1);
  });

  it('all-bot party: no rows, no bonus, no explosion', async () => {
    const h = partyOf(['U0FAKE0002', 'U0FAKE0003'], true);
    await cmd().run(h.ctx);
    expect(h.store.getLeaderboard(10)).toHaveLength(0);
    expect(h.store.getTotalReceived(GIVER.id)).toBe(0);
    expect(booms(h.replies)).toBe(0);
  });

  it('two concurrent first gives: exactly one bonus row', async () => {
    const a = makeCtx({ mentions: [BOB] });
    const b = makeCtx({ store: a.store, mentions: [CAROL] });
    const c = cmd();
    await Promise.all([c.run(a.ctx), c.run(b.ctx)]);
    expect(a.store.getTotalReceived(GIVER.id)).toBe(1);
  });

  it('bonus recipient who later gets a human sparkle sees no first-sparkle celebration', async () => {
    const h = makeCtx({ mentions: [BOB] });
    await cmd().run(h.ctx); // alice's first give: bonus makes alice's total 1
    const later = makeCtx({ store: h.store, giver: CAROL, mentions: [GIVER] });
    await cmd().run(later.ctx);
    expect(later.replies[0]).toContain('*carol* gave a sparkle to *alice*'); // plain award, not a celebration
    expect(later.replies[0]).toContain('now has *2*');
  });
});
