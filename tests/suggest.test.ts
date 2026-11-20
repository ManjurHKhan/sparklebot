import { describe, it, expect } from 'vitest';
import { createSuggestCommand } from '../src/commands/suggest.js';
import { Cooldown } from '../src/framework/rate-limit.js';
import { makeCtx } from './helpers/ctx.js';

function setup(args: string, now = { t: 0 }) {
  const cmd = createSuggestCommand({ cooldown: new Cooldown(600_000, () => now.t) });
  const h = makeCtx({ command: 'suggest', args });
  return { cmd, h, now };
}

describe('.suggest', () => {
  it('owner gets the escaped idea, suggester gets thanks', async () => {
    const { cmd, h } = setup('a leaderboard by team');
    await cmd.run(h.ctx);
    expect(h.ownerDms).toEqual(['💡 Suggestion from *alice* in #general: a leaderboard by team']);
    expect(h.ephemerals).toEqual(['💡 Thanks! Your idea went to the Sparklebot team.']);
    expect(h.replies).toHaveLength(0); // nothing public
  });

  it('empty and 257-char ideas rejected without consuming the cooldown', async () => {
    const { cmd, h } = setup('   ');
    await cmd.run(h.ctx);
    h.ctx.args = 'x'.repeat(257);
    await cmd.run(h.ctx);
    expect(h.ownerDms).toHaveLength(0);
    expect(h.ephemerals).toHaveLength(2);
    h.ctx.args = 'a real idea';
    await cmd.run(h.ctx);
    expect(h.ownerDms).toHaveLength(1);
  });

  it('a 256-char idea reaches the owner whole', async () => {
    const idea = `${'x'.repeat(255)}Z`;
    const { cmd, h } = setup(idea);
    await cmd.run(h.ctx);
    expect(h.ownerDms[0]).toContain(idea);
    expect(h.ownerDms[0]).not.toContain('…');
  });

  it('an idea that grows past 256 under normalization is rejected, not truncated', async () => {
    const { cmd, h } = setup('\uFDFA'.repeat(20)); // 20 chars, 360 after NFKC
    await cmd.run(h.ctx);
    expect(h.ownerDms).toHaveLength(0);
    expect(h.ephemerals[0]).toContain('256');
  });

  it('second idea within 600 s blocked, allowed after', async () => {
    const { cmd, h, now } = setup('one');
    await cmd.run(h.ctx);
    now.t = 599_000;
    h.ctx.args = 'two';
    await cmd.run(h.ctx);
    expect(h.ownerDms).toHaveLength(1);
    now.t = 600_000;
    await cmd.run(h.ctx);
    expect(h.ownerDms).toHaveLength(2);
  });

  it('notifyOwner false gives the failure ephemeral', async () => {
    const { cmd, h } = setup('an idea');
    h.owner.fail = true;
    await cmd.run(h.ctx);
    expect(h.ephemerals).toEqual(["Couldn't deliver that right now. Try again later."]);
  });
});
