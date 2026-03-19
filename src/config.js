function sanitizeColor(value, fallback) {
  // Only allow valid CSS hex colors
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

export default function loadConfig() {
  return {
    // Slack
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackClientId: process.env.SLACK_CLIENT_ID,
    slackClientSecret: process.env.SLACK_CLIENT_SECRET,
    sessionSecret: process.env.SPARKLE_SESSION_SECRET,
    oauthRedirectUri: process.env.SPARKLE_OAUTH_REDIRECT_URI || '',

    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    dbPath: process.env.SPARKLE_DB_PATH || null,

    // Personalization
    currency: process.env.SPARKLE_CURRENCY || 'sparkle',
    currencyPlural: process.env.SPARKLE_CURRENCY_PLURAL || 'sparkles',
    emoji: process.env.SPARKLE_EMOJI || '\u2728',
    personality: process.env.SPARKLE_PERSONALITY || 'playful',
    colorPrimary: sanitizeColor(process.env.SPARKLE_COLOR_PRIMARY, '#6C5CE7'),
    colorAccent: sanitizeColor(process.env.SPARKLE_COLOR_ACCENT, '#FFEAA7'),
    logoUrl: process.env.SPARKLE_LOGO_URL || '',

    // Behavior
    partyMinutes: parseInt(process.env.SPARKLE_PARTY_MINUTES || '30', 10),
    batchInitialSeconds: parseInt(process.env.SPARKLE_BATCH_INITIAL_SECONDS || '15', 10),
    batchExtendSeconds: parseInt(process.env.SPARKLE_BATCH_EXTEND_SECONDS || '15', 10),
    batchMaxSeconds: parseInt(process.env.SPARKLE_BATCH_MAX_SECONDS || '120', 10),
  };
}
