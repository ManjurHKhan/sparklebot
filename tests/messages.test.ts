import { describe, it, expect } from 'vitest';
// .ts specifier: the legacy src/messages.js coexists until the legacy-removal task,
// and vitest would otherwise resolve the .js specifier to that file.
import { createMessages } from '../src/messages.ts';
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
