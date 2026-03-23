import { describe, it, expect } from 'vitest';
import { createMessages } from '../src/messages.js';

describe('messages', () => {
  it('loads playful personality by default', () => {
    const msg = createMessages('playful');
    expect(msg.encouragement({ user: 'bob', count: 5, currency: 'sparkles' })).toBeTruthy();
  });

  it('substitutes template variables into encouragement', () => {
    const msg = createMessages('playful');
    const text = msg.encouragement({ user: 'alice', giver: 'bob', count: 10, currency: 'sparkles' });
    expect(text).toContain('alice');
    expect(text).toContain('bob');
    expect(text).toContain('10');
  });

  it('loads pirate personality', () => {
    const msg = createMessages('pirate');
    expect(msg.encouragement({ user: 'bob', count: 1, currency: 'doubloons' })).toBeTruthy();
  });

  it('falls back to playful for unknown personality', () => {
    const msg = createMessages('nonexistent');
    expect(msg.encouragement({ user: 'bob', count: 1, currency: 'sparkles' })).toBeTruthy();
  });

  it('returns self-sparkle shame messages with user and attempts', () => {
    const msg = createMessages('playful');
    const text = msg.selfSparkleShame({ user: 'bob', attempts: 3 });
    expect(text).toContain('bob');
    expect(text).toContain('3');
  });

  it('returns bot sparkle quips as non-empty string', () => {
    const msg = createMessages('playful');
    const text = msg.botSparkleQuip({ user: 'sparklebot', giver: 'alice', currency: 'sparkle' });
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    // Not all quip templates use {giver}, so don't assert on specific vars
    expect(text).not.toContain('{giver}');
    expect(text).not.toContain('{user}');
    expect(text).not.toContain('{currency}');
  });

  it('returns first sparkle celebration with all variables', () => {
    const msg = createMessages('playful');
    const text = msg.firstSparkleCelebration({
      user: '*alice*', giver: '*bob*', currency: 'sparkle',
      emoji: ':sparkles:', count: 1, reason: ' for _being awesome_',
    });
    expect(text).toContain('alice');
    expect(text).toContain('bob');
    expect(text).toContain(':sparkles:');
    expect(text).toContain('*1*');
    expect(text).toContain('being awesome');
  });

  it('returns first sparkle celebration with empty reason', () => {
    const msg = createMessages('playful');
    const text = msg.firstSparkleCelebration({
      user: '*alice*', giver: '*bob*', currency: 'sparkle',
      emoji: ':sparkles:', count: 1, reason: '',
    });
    expect(text).toContain('alice');
    expect(text).toContain('*1*');
    expect(text).not.toContain('for _');
  });

  it('returns party announcements with all variables', () => {
    const msg = createMessages('playful');
    const text = msg.partyAnnouncement({
      user: '*alice*', count: 3, channel: '#general',
      currency: 'sparkles', recipients: ':sparkles: *bob* now has *5* ✨\n> :sparkles: *carol* now has *2* ✨',
      people: 'people',
    });
    expect(text).toContain('alice');
    expect(text).toContain('3');
    expect(text).toContain('#general');
    expect(text).not.toContain('{currency}');
    expect(text).not.toContain('{recipients}');
    expect(text).not.toContain('{people}');
    expect(text).toContain('bob');
    expect(text).toContain('carol');
  });

  it('party announcement uses singular person when count is 1', () => {
    const msg = createMessages('playful');
    const text = msg.partyAnnouncement({
      user: '*alice*', count: 1, channel: '#general',
      currency: 'sparkle', recipients: ':sparkles: *bob* now has *1* ✨',
      people: 'person',
    });
    expect(text).not.toContain('{people}');
  });

  it('no personality has unsubstituted {currencyPlural} in templates', () => {
    for (const personality of ['playful', 'professional', 'sarcastic', 'pirate']) {
      const msg = createMessages(personality);
      const text = msg.firstSparkleCelebration({
        user: '*test*', giver: '*giver*', currency: 'sparkle',
        emoji: ':sparkles:', count: 1, reason: '',
      });
      expect(text).not.toContain('{currencyPlural}');
    }
  });
});
