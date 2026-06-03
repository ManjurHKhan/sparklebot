import { describe, it, expect } from 'vitest';
import { escapeText, fmt, trusted, joinSafe, isSafe } from '../src/framework/safe.js';

describe('escapeText', () => {
  it('entity-escapes < > & killing mentions and broadcast tags', () => {
    expect(escapeText('<!here> & <@U0FAKE0001>')).toBe(
      '&lt;!here&gt; &amp; &lt;@U0FAKE0001&gt;'
    );
  });

  it('neutralizes mrkdwn chars with ZWSP', () => {
    const out = escapeText('*bold* _it_ ~st~ `code`');
    expect(out).not.toMatch(/\*(?!​)/); // every * followed by ZWSP
    expect(out).toContain('*​bold*​');
  });

  it('NFKC-normalizes homographs', () => {
    expect(escapeText('Ａdmin')).toBe('Admin'); // fullwidth A collapses
  });

  it('caps field length at 256 by default', () => {
    const out = escapeText('a'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(257); // 256 + ellipsis
  });
});

describe('fmt / SafeText', () => {
  it('escapes string interpolations, keeps literals raw', () => {
    const evil = '<!channel> *pwn*';
    const m = fmt`Hello *${evil}*!`;
    expect(m.text).toBe('Hello *&lt;!channel&gt; *​pwn*​*!');
    expect(isSafe(m)).toBe(true);
  });

  it('cannot be forged with an object literal or spread', () => {
    expect(isSafe({ text: 'evil', __safe: true } as never)).toBe(false);
    expect(isSafe({ ...fmt`real`, text: 'swapped' } as never)).toBe(false);
  });

  it('passes nested SafeText through unescaped', () => {
    const inner = fmt`*${'bob'}*`;
    const outer = fmt`Hi ${inner}`;
    expect(outer.text).toBe('Hi *bob*');
  });

  it('stringifies numbers', () => {
    expect(fmt`${5} sparkles`.text).toBe('5 sparkles');
  });

  it('caps whole message length', () => {
    const m = fmt`${trusted('x'.repeat(5000))}`;
    expect(m.text.length).toBeLessThanOrEqual(3000);
  });
});

describe('joinSafe', () => {
  it('joins SafeText parts with a trusted separator', () => {
    expect(joinSafe([fmt`a`, fmt`b`], '\n> ').text).toBe('a\n> b');
  });
});
