import { describe, it, expect } from 'vitest';
import { createSparkleCommand } from '../src/commands/sparkle.js';
import { tierEmoji } from '../src/commands/sparkle.js';
import { createMessages } from '../src/messages.js';
import { Cooldown } from '../src/framework/rate-limit.js';
import { makeCtx, GIVER, BOT } from './helpers/ctx.js';
import type { User } from '../src/framework/types.js';

const BOB: User = { id: 'U0FAKE0002', name: 'bob', isBot: false };
const OWN_BOT: User = { id: BOT, name: 'sparklebot', isBot: true };

function cmd() {
  return createSparkleCommand({
    messages: createMessages('playful'),
    config: { currency: 'sparkle', currencyPlural: 'sparkles', partyMinutes: 30, partyMaxRecipients: 10 },
    partyChannelCooldown: new Cooldown(300_000, () => 0),
    partyGiverCooldown: new Cooldown(1_800_000, () => 0),
  });
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
    expect(h.replies).toHaveLength(1);
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
    expect(h.replies).toHaveLength(2);
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

  it('awards everyone active, atomically, and announces once', async () => {
    const h = partyHarness(['U0FAKE0002', 'U0FAKE0003']);
    await cmd().run(h.ctx);
    expect(h.store.getTotalReceived('U0FAKE0002')).toBe(1);
    expect(h.store.getTotalReceived('U0FAKE0003')).toBe(1);
    expect(h.replies).toHaveLength(1);
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
    });
    const h1 = partyHarness(['U0FAKE0002']);
    await c.run(h1.ctx);
    expect(h1.replies).toHaveLength(1);

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
    expect(h4.replies).toHaveLength(1);
  });

  it('replies when no one is active', async () => {
    const h = partyHarness([]);
    await cmd().run(h.ctx);
    expect(h.replies[0]).toMatch(/no one/i);
    expect(h.store.getLeaderboard(10)).toHaveLength(0);
  });
});
