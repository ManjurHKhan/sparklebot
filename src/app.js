import { App } from '@slack/bolt';
import express from 'express';
import cookieSession from 'cookie-session';
import path from 'path';
import { fileURLToPath } from 'url';
import loadConfig from './config.js';
import { createDb } from './db.js';
import { createMessages } from './messages.js';
import { createBatcher } from './batcher.js';
import { handleSparkle } from './handlers/sparkle.js';
import { handleLeaderboard } from './handlers/leaderboard.js';
import { formatBatchConfirmation } from './formatter.js';
import { setupAuth } from './web/auth.js';
import { setupRoutes } from './web/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

if (!config.sessionSecret) {
  console.error('SPARKLE_SESSION_SECRET is required. Set it to a random string (32+ chars).');
  process.exit(1);
}
const dbPath = config.dbPath || path.join(__dirname, '..', 'data', 'sparklebot.db');
const db = createDb(dbPath);
const messages = createMessages(config.personality);

// Express app for web dashboard
const expressApp = express();
expressApp.set('view engine', 'ejs');
expressApp.set('views', path.join(__dirname, 'web', 'views'));
expressApp.use('/public', express.static(path.join(__dirname, 'web', 'public')));
expressApp.use(cookieSession({
  name: 'sparklebot',
  secret: config.sessionSecret,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

// Security headers
expressApp.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0'); // disabled per OWASP -- rely on CSP instead
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https:;");
  next();
});

// Health probe
expressApp.get('/healthz', (req, res) => res.send('ok'));

// Auth and dashboard routes
setupAuth(expressApp, config);
setupRoutes(expressApp, db, config);

// Batcher flush callback -- posts confirmation to Slack
let boltApp = null;

const batcher = createBatcher(
  { initialSeconds: config.batchInitialSeconds, extendSeconds: config.batchExtendSeconds, maxSeconds: config.batchMaxSeconds },
  async (batch) => {
    if (!boltApp) return;
    const totalCount = db.getTotalReceived(batch.receiverId);
    const encouragement = messages.encouragement({
      user: batch.sparkles[0]?.receiverName || batch.receiverId,
      count: totalCount,
      currency: config.currencyPlural,
    });
    const text = formatBatchConfirmation({
      receiverId: batch.receiverId,
      sparkles: batch.sparkles,
      totalCount,
      encouragement,
      currency: config.currencyPlural,
      emoji: config.emoji,
    });
    try {
      await boltApp.client.chat.postMessage({
        channel: batch.channelId,
        text,
      });
    } catch (err) {
      console.error('Failed to post batch confirmation:', err.message);
    }
  }
);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, flushing pending batches...');
  batcher.flushAll();
  db.close();
  process.exit(0);
});

// Start Express (always)
const port = config.port;
expressApp.listen(port, () => console.log(`Dashboard running on port ${port}`));

// Start Bolt (only if Slack tokens are configured)
if (config.slackBotToken && config.slackAppToken) {
  boltApp = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    socketMode: true,
    appToken: config.slackAppToken,
  });

  boltApp.message(async ({ message, client }) => {
    if (!message.text) return;

    if (message.text.startsWith('.sparkle ') || message.text === '.sparkle party') {
      await handleSparkle({ message, client, db, batcher, messages, config });
    } else if (message.text === '.sparkles') {
      await handleLeaderboard({ message, client, db, config });
    }
  });

  boltApp.start().then(() => console.log('Bolt app connected via Socket Mode'));
} else {
  console.log('Slack tokens not configured, running dashboard only');
}
