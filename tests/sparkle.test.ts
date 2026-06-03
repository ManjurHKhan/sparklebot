import { describe, it, expect } from 'vitest';
import { createSparkleCommand } from '../src/commands/sparkle.js';
import { tierEmoji } from '../src/commands/sparkle.js';
// .ts specifier: legacy src/messages.js coexists until legacy removal and vitest
// would resolve a .js specifier to it.
import { createMessages } from '../src/messages.ts';
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
