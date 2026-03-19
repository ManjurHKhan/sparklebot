import { describe, it, expect } from 'vitest';
import { formatLeaderboard } from '../../src/handlers/leaderboard.js';

describe('formatLeaderboard', () => {
  const board = [
    { receiver_id: 'U1', receiver_name: 'alice', count: 42 },
    { receiver_id: 'U2', receiver_name: 'bob', count: 38 },
    { receiver_id: 'U3', receiver_name: 'carol', count: 31 },
    { receiver_id: 'U4', receiver_name: 'dave', count: 25 },
  ];

  it('formats leaderboard with medals for top 3', () => {
    const text = formatLeaderboard(board, { userId: 'U1', rank: 1, count: 42 }, 'sparkles');
    expect(text).toContain('\uD83E\uDD47');
    expect(text).toContain('\uD83E\uDD48');
    expect(text).toContain('\uD83E\uDD49');
    expect(text).toContain('alice');
    expect(text).toContain('42');
  });

  it('shows user rank when not in top 10', () => {
    const text = formatLeaderboard(board, { userId: 'U99', rank: 14, count: 5 }, 'sparkles');
    expect(text).toContain('#14');
    expect(text).toContain('5');
  });

  it('uses custom currency name', () => {
    const text = formatLeaderboard(board, { userId: 'U1', rank: 1, count: 42 }, 'kudos');
    expect(text).toContain('kudos');
  });
});
