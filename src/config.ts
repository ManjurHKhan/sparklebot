export interface Config {
  slackBotToken: string | undefined;
  slackSigningSecret: string | undefined;
  slackAppToken: string | undefined;
  dbPath: string;
  currency: string;
  currencyPlural: string;
  personality: string;
  partyMinutes: number;
  partyMaxRecipients: number;
  partyChannelCooldownMs: number;
  partyGiverCooldownMs: number;
  rateLimit: { limit: number; windowMs: number };
  healthPort: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const int = (v: string | undefined, dflt: number) => {
    const n = parseInt(v ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  return {
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    slackAppToken: env.SLACK_APP_TOKEN,
    dbPath: env.SPARKLE_DB_PATH || 'data/sparklebot.db',
    currency: env.SPARKLE_CURRENCY || 'sparkle',
    currencyPlural: env.SPARKLE_CURRENCY_PLURAL || 'sparkles',
    personality: env.SPARKLE_PERSONALITY || 'playful',
    partyMinutes: int(env.SPARKLE_PARTY_MINUTES, 30),
    // Clamped: env can lower the party cap but never raise it above the hard security cap.
    partyMaxRecipients: Math.min(int(env.SPARKLE_PARTY_MAX_RECIPIENTS, 10), 10),
    partyChannelCooldownMs: int(env.SPARKLE_PARTY_CHANNEL_COOLDOWN_S, 300) * 1000,
    partyGiverCooldownMs: int(env.SPARKLE_PARTY_GIVER_COOLDOWN_S, 1800) * 1000,
    rateLimit: {
      limit: int(env.SPARKLE_RATE_LIMIT, 10),
      windowMs: int(env.SPARKLE_RATE_WINDOW_S, 60) * 1000,
    },
    healthPort: int(env.HEALTH_PORT, 8080),
  };
}
