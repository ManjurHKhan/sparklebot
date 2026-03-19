import { describe, it, expect } from 'vitest';
import { formatBatchConfirmation } from '../src/formatter.js';

describe('formatBatchConfirmation', () => {
  it('formats single sparkle with reason', () => {
    const text = formatBatchConfirmation({
      receiverId: 'U1',
      sparkles: [{ giverName: 'alice', reason: 'great work' }],
      totalCount: 5,
      encouragement: 'Boo-yah!',
      currency: 'sparkles',
      emoji: '\u2728',
    });
    expect(text).toContain('<@U1>');
    expect(text).toContain('alice');
    expect(text).toContain('great work');
    expect(text).toContain('5');
  });

  it('formats multiple sparkles, groups givers without reasons', () => {
    const text = formatBatchConfirmation({
      receiverId: 'U1',
      sparkles: [
        { giverName: 'alice', reason: 'great presentation' },
        { giverName: 'bob', reason: null },
        { giverName: 'carol', reason: null },
      ],
      totalCount: 10,
      encouragement: 'Holy guacamole!',
      currency: 'sparkles',
      emoji: '\u2728',
    });
    expect(text).toContain('alice: great presentation');
    expect(text).toMatch(/bob.*carol|carol.*bob/);
  });

  it('handles single sparkle with no reason', () => {
    const text = formatBatchConfirmation({
      receiverId: 'U1',
      sparkles: [{ giverName: 'alice', reason: null }],
      totalCount: 1,
      encouragement: 'Nice!',
      currency: 'sparkles',
      emoji: '\u2728',
    });
    expect(text).toContain('<@U1>');
    expect(text).toContain('alice');
  });

  it('does not @ mention givers', () => {
    const text = formatBatchConfirmation({
      receiverId: 'U1',
      sparkles: [{ giverName: 'alice', reason: 'nice' }],
      totalCount: 3,
      encouragement: 'Wow!',
      currency: 'sparkles',
      emoji: '\u2728',
    });
    // Only one <@ mention should exist (the receiver)
    const mentions = text.match(/<@/g) || [];
    expect(mentions).toHaveLength(1);
  });
});
