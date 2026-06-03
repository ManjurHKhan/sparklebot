import { describe, it, expect } from 'vitest';
import { createSparklesCommand } from '../src/commands/sparkles.js';
import { makeCtx, GIVER } from './helpers/ctx.js';

const cfg = { currency: 'sparkle', currencyPlural: 'sparkles' };

function seed(store: ReturnType<typeof makeCtx>['store']) {
  const row = (receiverId: string, receiverName: string) => ({
    giverId: 'U0FAKE0009', giverName: 'g', receiverId, receiverName,
    reason: null, channelId: 'C0FAKE0001', channelName: 'general',
  });
  // bob=3, evil=2 — counts distinct so board order never depends on a tiebreak.
  store.insertSparkles([
    row('U0FAKE0002', 'bob'), row('U0FAKE0002', 'bob'), row('U0FAKE0002', 'bob'),
    row('U0FAKE0003', '<!here>*evil*'), row('U0FAKE0003', '<!here>*evil*'),
  ]);
}

describe('.sparkles', () => {
  it('DMs the leaderboard with medals and escaped names', async () => {
    const h = makeCtx();
    seed(h.store);
    await createSparklesCommand(cfg).run(h.ctx);
    expect(h.dms).toHaveLength(1);
    const text = h.dms[0]!;
    expect(text).toContain('🥇');
    expect(text).toContain('bob');
    expect(text).not.toContain('<!here>');      // injected name rendered inert
    expect(text).toContain('&lt;!here&gt;');
  });

  it("appends the caller's own rank when not on the board", async () => {
    const h = makeCtx();
    seed(h.store);
    h.store.insertSparkles([{
      giverId: 'U0FAKE0009', giverName: 'g', receiverId: GIVER.id, receiverName: 'alice',
      reason: null, channelId: 'C0FAKE0001', channelName: 'general',
    }]);
    await createSparklesCommand(cfg, 2).run(h.ctx); // top-2 = bob(3), evil(2); alice(1) off board, rank #3
    expect(h.dms[0]!).toMatch(/ranked #\d+/);
  });

  it('takes no targets', () => {
    expect(createSparklesCommand(cfg).takesTargets()).toBe(false);
  });
});
