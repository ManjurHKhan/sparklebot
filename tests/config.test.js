import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.keys(process.env).forEach(k => {
      if (k.startsWith('SPARKLE_')) delete process.env[k];
    });
    delete process.env.PORT;
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
    expect(config.colorPrimary).toBe('#6C5CE7');
    expect(config.colorAccent).toBe('#FFEAA7');
    expect(config.partyMinutes).toBe(30);
    expect(config.batchInitialSeconds).toBe(15);
    expect(config.batchExtendSeconds).toBe(15);
    expect(config.batchMaxSeconds).toBe(120);
    expect(config.port).toBe(3000);
  });

  it('overrides from env vars', async () => {
    process.env.SPARKLE_CURRENCY = 'kudos';
    process.env.SPARKLE_CURRENCY_PLURAL = 'kudos';
    process.env.SPARKLE_PERSONALITY = 'pirate';
    process.env.SPARKLE_COLOR_PRIMARY = '#FF0000';
    process.env.SPARKLE_PARTY_MINUTES = '60';
    process.env.PORT = '8080';
    const { default: loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.currency).toBe('kudos');
    expect(config.personality).toBe('pirate');
    expect(config.colorPrimary).toBe('#FF0000');
    expect(config.partyMinutes).toBe(60);
    expect(config.port).toBe(8080);
  });
});
