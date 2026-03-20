export default function loadConfig() {
  return {
    // Slack
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    slackAppToken: process.env.SLACK_APP_TOKEN,

    // Database
    dbPath: process.env.SPARKLE_DB_PATH || null,

    // Personalization
    currency: process.env.SPARKLE_CURRENCY || 'sparkle',
    currencyPlural: process.env.SPARKLE_CURRENCY_PLURAL || 'sparkles',
    emoji: process.env.SPARKLE_EMOJI || '\u2728',
    personality: process.env.SPARKLE_PERSONALITY || 'playful',

    // Behavior
    partyMinutes: parseInt(process.env.SPARKLE_PARTY_MINUTES || '30', 10),
  };
}
