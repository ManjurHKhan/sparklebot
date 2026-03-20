import { App } from '@slack/bolt';
import path from 'path';
import { fileURLToPath } from 'url';
import loadConfig from './config.js';
import { createDb } from './db.js';
import { createMessages } from './messages.js';
import { handleSparkle } from './handlers/sparkle.js';
import { handleLeaderboard } from './handlers/leaderboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

const dbPath = config.dbPath || path.join(__dirname, '..', 'data', 'sparklebot.db');
const db = createDb(dbPath);
const messages = createMessages(config.personality);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  db.close();
  process.exit(0);
});

if (!config.slackBotToken || !config.slackAppToken) {
  console.error('SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required.');
  process.exit(1);
}

const boltApp = new App({
  token: config.slackBotToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
  appToken: config.slackAppToken,
});

boltApp.message(async ({ message, client }) => {
  if (!message.text) return;

  try {
    if (message.text === '.sparkle' || message.text === '.sparkle help') {
      await client.chat.postMessage({
        channel: message.channel,
        text: [
          `*${config.emoji} Sparklebot Commands*`,
          '',
          '`.sparkle @user [reason]` — give someone a sparkle',
          '`.sparkle @user1 @user2 [reason]` — sparkle multiple people',
          '`.sparkle party` — sparkle everyone active in the last 30 min',
          '`.sparkles` — see the all-time leaderboard (via DM)',
        ].join('\n'),
      });
    } else if (message.text.startsWith('.sparkle ') || message.text === '.sparkle party') {
      await handleSparkle({ message, client, db, messages, config });
    } else if (message.text === '.sparkles') {
      await handleLeaderboard({ message, client, db, config });
    }
  } catch (err) {
    console.error('[ERROR] Handler failed:', err);
  }
});

boltApp.start().then(() => console.log('Sparklebot connected via Socket Mode'));
