import { CHANNEL_ID_RE, EMOJI_BURST_RE, USER_ID_RE, escapeText } from './framework/safe.js';

export interface WelcomeChannel {
  id: string;
  about: string;
}

const DEFAULT_MEGA_EMOJI = ':fireworks::sparkles::boom::sparkles::fireworks:';
const MAX_BURST_LEN = 200;
const MAX_TOUR = 15;
// Measured escaped: 15 rows of this plus the fixed lines stays under MAX_MESSAGE_LEN (3000).
const MAX_ABOUT = 120;

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
  commandLimit: { limit: number; windowMs: number };
  healthPort: number;
  welcomeChannel?: string;
  welcomeChannels: WelcomeChannel[];
  megaEmoji: string;
  suggestTo?: string;
  /** Problems found while parsing; logged at startup. A bad value disables its feature, never crashes. */
  configWarnings: string[];
}

function parseTour(raw: string | undefined, warn: (m: string) => void): WelcomeChannel[] {
  if (!raw) return [];
  const bad = (why: string) => { warn(`SPARKLE_WELCOME_CHANNELS ${why}; channel tour disabled`); return []; };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return bad('is not valid JSON');
  }
  if (!Array.isArray(parsed)) return bad('must be a JSON array');
  const out: WelcomeChannel[] = [];
  for (const e of parsed as Array<{ id?: unknown; about?: unknown }>) {
    if (typeof e?.id !== 'string' || !CHANNEL_ID_RE.test(e.id)) return bad('has an entry with an invalid channel id');
    if (typeof e.about !== 'string' || e.about.trim() === '') return bad(`entry ${e.id} has an empty about`);
    if (escapeText(e.about).length > MAX_ABOUT) return bad(`entry ${e.id} about exceeds ${MAX_ABOUT} characters escaped`);
    out.push({ id: e.id, about: e.about });
  }
  if (out.length > MAX_TOUR) {
    warn(`SPARKLE_WELCOME_CHANNELS has ${out.length} entries; only the first ${MAX_TOUR} are used`);
    return out.slice(0, MAX_TOUR);
  }
  return out;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const int = (v: string | undefined, dflt: number) => {
    const n = parseInt(v ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const configWarnings: string[] = [];
  const warn = (m: string) => configWarnings.push(m);
  // Empty or unset means off/default with no warning; a set-but-invalid value warns.
  const id = (name: string, re: RegExp): string | undefined => {
    const v = env[name];
    if (!v) return undefined;
    if (re.test(v)) return v;
    warn(`${name} is not a valid Slack ID; feature disabled`);
    return undefined;
  };
  const mega = env.SPARKLE_MEGA_EMOJI;
  let megaEmoji = DEFAULT_MEGA_EMOJI;
  if (mega) {
    if (mega.length <= MAX_BURST_LEN && EMOJI_BURST_RE.test(mega)) megaEmoji = mega;
    else warn('SPARKLE_MEGA_EMOJI must be 1-23 :shortcodes: and at most 200 characters; using the default');
  }

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
    // Invocation throttle (all commands, incl. non-award paths) — looser than the
    // award budget; it exists to stop channel/DM spam, not scoreboard abuse.
    commandLimit: {
      limit: int(env.SPARKLE_CMD_LIMIT, 20),
      windowMs: int(env.SPARKLE_CMD_WINDOW_S, 60) * 1000,
    },
    healthPort: int(env.HEALTH_PORT, 8080),
    welcomeChannel: id('SPARKLE_WELCOME_CHANNEL', CHANNEL_ID_RE),
    welcomeChannels: parseTour(env.SPARKLE_WELCOME_CHANNELS, warn),
    megaEmoji,
    suggestTo: id('SPARKLE_SUGGEST_TO', USER_ID_RE),
    configWarnings,
  };
}
