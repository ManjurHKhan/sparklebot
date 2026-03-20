import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.keys(process.env).forEach(k => {
      if (k.startsWith('SPARKLE_')) delete process.env[k];
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns defaults when no env vars set', async () => {
    const { default: loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.currency).toBe('sparkle');
    expect(config.currencyPlural).toBe('sparkles');
    expect(config.personality).toBe('playful');
    expect(config.partyMinutes).toBe(30);
  });

  it('overrides from env vars', async () => {
    process.env.SPARKLE_CURRENCY = 'kudos';
    process.env.SPARKLE_CURRENCY_PLURAL = 'kudos';
    process.env.SPARKLE_PERSONALITY = 'pirate';
    process.env.SPARKLE_PARTY_MINUTES = '60';
    const { default: loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.currency).toBe('kudos');
    expect(config.personality).toBe('pirate');
    expect(config.partyMinutes).toBe(60);
  });
});
