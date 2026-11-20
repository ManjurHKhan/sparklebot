import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMessages } from '../src/messages.js';
import { readFileSync } from 'node:fs';
import { fmt, isSafe, userMention } from '../src/framework/safe.js';

describe('createMessages', () => {
  const m = createMessages('playful');

  it('returns SafeText with vars substituted', () => {
    const out = m.selfSparkleShame({ user: fmt`*${'alice'}*`, attempts: 2 });
    expect(isSafe(out)).toBe(true);
    expect(out.text).toContain('*alice*');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escapes raw-string vars', () => {
    // Pin template selection: one botSparkleQuips template has no {giver} slot,
    // which would make this assertion flake under random selection.
    vi.spyOn(Math, 'random').mockReturnValue(0);
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

describe('welcome and first-give lines', () => {
  const personalities = ['playful', 'professional', 'sarcastic', 'pirate'];
  const required: Array<[string, string]> = [['welcomePublic', '{mention}'], ['welcomeDM', '{user}'], ['firstGiveBonus', '{user}']];

  it.each(personalities)('%s has every array, non-empty, with its required slot', (p) => {
    const json = JSON.parse(readFileSync(`src/personalities/${p}.json`, 'utf-8')) as Record<string, string[]>;
    for (const [key, slot] of required) {
      expect(json[key], `${p}.${key}`).toBeInstanceOf(Array);
      expect(json[key]!.length, `${p}.${key}`).toBeGreaterThan(0);
      for (const t of json[key]!) expect(t, `${p}.${key}`).toContain(slot);
    }
    for (const t of json.welcomePublic!) expect((t.match(/\{mention\}/g) ?? []).length, t).toBe(1);
  });

  // An unknown slot renders literally ("{foo}"), so each array may use only the slots its caller passes.
  const allowed: Record<string, string[]> = {
    welcomePublic: ['mention', 'currency'],
    welcomeDM: ['user', 'currency', 'currencyPlural'],
    firstGiveBonus: ['user', 'count', 'currency'],
  };
  it.each(personalities)('%s new lines use only the slots their caller passes', (p) => {
    const json = JSON.parse(readFileSync(`src/personalities/${p}.json`, 'utf-8')) as Record<string, string[]>;
    for (const [key, slots] of Object.entries(allowed)) {
      for (const t of json[key]!) {
        for (const [, slot] of t.matchAll(/\{(\w+)\}/g)) expect(slots, `${p}.${key}: ${t}`).toContain(slot);
      }
    }
  });

  const m = createMessages('playful');

  it('welcomeDM escapes the name it is given', () => {
    const out = m.welcomeDM({ user: '<!channel>' });
    expect(out.text).not.toContain('<!channel>');
    expect(out.text).toContain('&lt;!channel&gt;');
  });

  it('firstGiveBonus escapes the name it is given', () => {
    const out = m.firstGiveBonus({ user: '<@U0FAKE0001>', count: 1, currency: 'sparkle' });
    expect(out.text).not.toContain('<@');
    expect(out.text).toContain('&lt;@U0FAKE0001&gt;');
  });

  it('welcomePublic keeps a SafeText mention intact', () => {
    const out = m.welcomePublic({ mention: userMention('U0FAKE0010'), currency: 'sparkle' });
    expect(out.text).toContain('<@U0FAKE0010>');
  });
});
