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
