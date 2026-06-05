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
    expect(out).toContain('code');
    expect(out).not.toContain('`');
  });

  it('NFKC-normalizes homographs', () => {
    expect(escapeText('Ａdmin')).toBe('Admin'); // fullwidth A collapses
  });

  it('breaks URLs after NFKC normalization so Slack cannot autolink them', () => {
    expect(escapeText('ｈｔｔｐｓ：／／google．ｃｏｍ')).toBe('`https://google.com`');
    expect(escapeText('https://evil.example/path')).toBe('`https://evil.example/path`');
    expect(escapeText('www.evil.example')).toBe('`www.evil.example`');
  });

  it('renders Unicode, punycode, and IPv4 link-like text as code', () => {
    expect(escapeText('раураl.com')).toBe('`раураl.com`');
    expect(escapeText('evil.xn--p1ai')).toBe('`evil.xn--p1ai`');
    expect(escapeText('192.168.1.1')).toBe('`192.168.1.1`');
    expect(escapeText('192.168.1.1:8080/path')).toBe('`192.168.1.1:8080/path`');
  });

  it('keeps sentence punctuation outside rendered link code', () => {
    expect(escapeText('go to https://evil.example/path, now')).toBe('go to `https://evil.example/path`, now');
    expect(escapeText('see evil.example.')).toBe('see `evil.example`.');
  });

  it('strips Slack link wrappers and labels before rendering links as code', () => {
    expect(escapeText('<https://evil.example|click here>')).toBe('`https://evil.example`');
    expect(escapeText('＜ｈｔｔｐｓ：／／google．ｃｏｍ|Claim Your Sparkles Here!＞')).toBe('`https://google.com`');
    expect(escapeText('< ｈｔｔｐｓ：／／google．ｃｏｍ | padded label >')).toBe('`https://google.com`');
    expect(escapeText('＜https://evil.example/path(foo)?a=(b)|SAFE LABEL＞')).toBe(
      '`https://evil.example/path(foo)?a=(b)`'
    );
    expect(escapeText('<https://evil.example|<@U0FAKE0001>>')).toBe('`https://evil.example`&gt;');
    expect(escapeText('<https://evil.example|<!channel>>')).toBe('`https://evil.example`&gt;');
  });

  it('neutralizes broadcast-looking plain text after NFKC normalization', () => {
    expect(escapeText('＠here ＠channel ＠everyone')).toBe('@​here @​channel @​everyone');
    expect(escapeText('＜!here＞')).toBe('&lt;!here&gt;');
  });

  it('strips unsafe invisible/control characters from user input', () => {
    expect(escapeText('pay\u202Ecod.exe\u200B')).toBe('`paycod.exe`');
    expect(escapeText('h\u2060ttps://evil.example')).toBe('`https://evil.example`');
    expect(escapeText('evil\uFEFF.example/path')).toBe('`evil.example/path`');
  });

  it('normalizes IDNA dot variants before link detection', () => {
    expect(escapeText('evil.example\u3002com/path')).toBe('`evil.example.com/path`');
    expect(escapeText('evil.example\uFF61com/path')).toBe('`evil.example.com/path`');
  });

  it('strips user backticks so they cannot break sanitizer-owned link code', () => {
    expect(escapeText('` https://evil.example `')).toBe(' `https://evil.example` ');
    expect(escapeText('https://evil.example/`<!here>`')).toBe('`https://evil.example/`&lt;!here&gt;');
  });

  it('caps field length at 256 by default', () => {
    const out = escapeText('a'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(257); // 256 + ellipsis
  });

  it('truncation boundary is exact: 256 passes untouched, 257 truncates to 256+ellipsis', () => {
    expect(escapeText('a'.repeat(256))).toBe('a'.repeat(256));
    expect(escapeText('a'.repeat(257))).toBe(`${'a'.repeat(256)}…`);
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
