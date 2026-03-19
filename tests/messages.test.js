import { describe, it, expect } from 'vitest';
import { createMessages } from '../src/messages.js';

describe('messages', () => {
  it('loads playful personality by default', () => {
    const msg = createMessages('playful');
    expect(msg.encouragement({ user: 'bob', count: 5, currency: 'sparkles' })).toBeTruthy();
  });

  it('substitutes template variables', () => {
    const msg = createMessages('playful');
    const text = msg.encouragement({ user: 'alice', count: 10, currency: 'sparkles' });
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('loads pirate personality', () => {
    const msg = createMessages('pirate');
    expect(msg.encouragement({ user: 'bob', count: 1, currency: 'doubloons' })).toBeTruthy();
  });

  it('falls back to playful for unknown personality', () => {
    const msg = createMessages('nonexistent');
    expect(msg.encouragement({ user: 'bob', count: 1, currency: 'sparkles' })).toBeTruthy();
  });

  it('returns self-sparkle shame messages', () => {
    const msg = createMessages('playful');
    const text = msg.selfSparkleShame({ user: 'bob', attempts: 3 });
    expect(typeof text).toBe('string');
  });

  it('returns bot sparkle quips', () => {
    const msg = createMessages('playful');
    const text = msg.botSparkleQuip({ user: 'bot', giver: 'alice' });
    expect(typeof text).toBe('string');
  });

  it('returns first sparkle celebration', () => {
    const msg = createMessages('playful');
    const text = msg.firstSparkleCelebration({ user: 'bob', giver: 'alice' });
    expect(typeof text).toBe('string');
  });

  it('returns party announcements', () => {
    const msg = createMessages('playful');
    const text = msg.partyAnnouncement({ user: 'alice', count: 8, channel: '#general' });
    expect(typeof text).toBe('string');
  });
});
