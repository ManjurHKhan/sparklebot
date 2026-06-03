import { describe, it, expect } from 'vitest';
import { createMessages } from '../src/messages.js';
import { fmt, isSafe } from '../src/framework/safe.js';

describe('createMessages', () => {
  const m = createMessages('playful');

  it('returns SafeText with vars substituted', () => {
    const out = m.selfSparkleShame({ user: fmt`*${'alice'}*`, attempts: 2 });
    expect(isSafe(out)).toBe(true);
    expect(out.text).toContain('*alice*');
  });

  it('escapes raw-string vars', () => {
    const out = m.botSparkleQuip({ giver: '<!here>', user: 'x', currency: 'sparkle' });
    expect(out.text).not.toContain('<!here>');
    expect(out.text).toContain('&lt;!here&gt;');
  });

  it('falls back to playful for unknown personalities', () => {
    const fallback = createMessages('nonexistent');
    expect(
      isSafe(
        fallback.partyAnnouncement({
          user: 'x',
          count: 1,
          channel: 'c',
          currency: 's',
          recipients: 'r',
          people: 'person',
        })
      )
    ).toBe(true);
  });
});
