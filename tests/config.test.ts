import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c.currency).toBe('sparkle');
    expect(c.rateLimit).toEqual({ limit: 10, windowMs: 60_000 });
    expect(c.partyChannelCooldownMs).toBe(300_000);
    expect(c.partyGiverCooldownMs).toBe(1_800_000);
    expect(c.partyMaxRecipients).toBe(10);
    expect(c.healthPort).toBe(8080);
  });

  it('reads env overrides', () => {
    const c = loadConfig({
      SLACK_BOT_TOKEN: 'xoxb-fake', SLACK_APP_TOKEN: 'xapp-fake',
      SPARKLE_RATE_LIMIT: '5', SPARKLE_PARTY_MINUTES: '15', HEALTH_PORT: '9999',
    });
    expect(c.slackBotToken).toBe('xoxb-fake');
    expect(c.rateLimit.limit).toBe(5);
    expect(c.partyMinutes).toBe(15);
    expect(c.healthPort).toBe(9999);
  });

  it('clamps party recipient cap to the hard maximum of 10', () => {
    expect(loadConfig({ SPARKLE_PARTY_MAX_RECIPIENTS: '50' }).partyMaxRecipients).toBe(10);
    expect(loadConfig({ SPARKLE_PARTY_MAX_RECIPIENTS: '3' }).partyMaxRecipients).toBe(3);
  });

  it('falls back to defaults for zero, negative, and non-numeric values', () => {
    const c = loadConfig({
      SPARKLE_RATE_LIMIT: '0',       // zero would disable awarding entirely
      HEALTH_PORT: '-5',             // negative port is unbindable
      SPARKLE_PARTY_MINUTES: 'abc',  // NaN
      SPARKLE_PARTY_MAX_RECIPIENTS: 'notanumber',
    });
    expect(c.rateLimit.limit).toBe(10);
    expect(c.healthPort).toBe(8080);
    expect(c.partyMinutes).toBe(30);
    expect(c.partyMaxRecipients).toBe(10);
  });
});

describe('loadConfig: welcome, tour, mega emoji, suggest', () => {
  const DEFAULT_BURST = ':fireworks::sparkles::boom::sparkles::fireworks:';
  const tour = (entries: unknown) => ({ SPARKLE_WELCOME_CHANNEL: 'C0FAKE0001', SPARKLE_WELCOME_CHANNELS: typeof entries === 'string' ? entries : JSON.stringify(entries) });

  it('defaults: welcome off, empty tour, default burst, suggest off, no warnings', () => {
    const c = loadConfig({});
    expect(c.welcomeChannel).toBeUndefined();
    expect(c.welcomeChannels).toEqual([]);
    expect(c.megaEmoji).toBe(DEFAULT_BURST);
    expect(c.suggestTo).toBeUndefined();
    expect(c.configWarnings).toEqual([]);
  });

  it('reads valid values for all four settings', () => {
    const c = loadConfig({
      SPARKLE_WELCOME_CHANNEL: 'C0FAKE0001',
      SPARKLE_WELCOME_CHANNELS: JSON.stringify([{ id: 'C0FAKE0002', about: 'say hi' }]),
      SPARKLE_MEGA_EMOJI: ':boom::sparkle_explosion:',
      SPARKLE_SUGGEST_TO: 'U0FAKE0001',
    });
    expect(c.welcomeChannel).toBe('C0FAKE0001');
    expect(c.welcomeChannels).toEqual([{ id: 'C0FAKE0002', about: 'say hi' }]);
    expect(c.megaEmoji).toBe(':boom::sparkle_explosion:');
    expect(c.suggestTo).toBe('U0FAKE0001');
    expect(c.configWarnings).toEqual([]);
  });

  it('accepts a legacy private channel ID (G prefix) for the welcome channel', () => {
    const c = loadConfig({ SPARKLE_WELCOME_CHANNEL: 'G0FAKE0001' });
    expect(c.welcomeChannel).toBe('G0FAKE0001');
    expect(c.configWarnings).toEqual([]);
  });

  it('invalid welcome channel turns welcome off with a warning', () => {
    const c = loadConfig({ SPARKLE_WELCOME_CHANNEL: '#general' });
    expect(c.welcomeChannel).toBeUndefined();
    expect(c.configWarnings.join('\n')).toContain('SPARKLE_WELCOME_CHANNEL');
  });

  it('invalid suggest target turns suggest off with a warning', () => {
    const c = loadConfig({ SPARKLE_SUGGEST_TO: 'alice' });
    expect(c.suggestTo).toBeUndefined();
    expect(c.configWarnings.join('\n')).toContain('SPARKLE_SUGGEST_TO');
  });

  it.each(['boom', `:${'a'.repeat(199)}:`])('invalid mega emoji %# falls back to the default with a warning', (v) => {
    const c = loadConfig({ SPARKLE_MEGA_EMOJI: v });
    expect(c.megaEmoji).toBe(DEFAULT_BURST);
    expect(c.configWarnings.join('\n')).toContain('SPARKLE_MEGA_EMOJI');
  });

  it.each([
    ['not JSON', '[{'],
    ['not an array', { id: 'C0FAKE0002', about: 'x' }],
    ['bad id', [{ id: '#random', about: 'x' }]],
    ['empty about', [{ id: 'C0FAKE0002', about: '' }]],
    ['escaped & over 120', [{ id: 'C0FAKE0002', about: '&'.repeat(30) }]],
    ['121-char about', [{ id: 'C0FAKE0002', about: 'a'.repeat(121) }]],
  ])('malformed tour (%s) skips the tour, keeps welcome on, warns', (_, entries) => {
    const c = loadConfig(tour(entries));
    expect(c.welcomeChannels).toEqual([]);
    expect(c.welcomeChannel).toBe('C0FAKE0001');
    expect(c.configWarnings.join('\n')).toContain('SPARKLE_WELCOME_CHANNELS');
  });

  it('keeps the first 15 tour entries and warns about the rest', () => {
    const entries = Array.from({ length: 16 }, (_, i) => ({ id: `C0FAKE${String(i).padStart(4, '0')}`, about: `channel ${i}` }));
    const c = loadConfig(tour(entries));
    expect(c.welcomeChannels).toEqual(entries.slice(0, 15));
    expect(c.configWarnings.join('\n')).toContain('15');
  });
});
