import { App } from '@slack/bolt';
import { loadConfig } from './config.js';
import { createSqliteStore } from './store/sqlite.js';
import { createMessages } from './messages.js';
import { Registry } from './framework/registry.js';
import { SlackResolver } from './framework/resolver.js';
import { SlidingWindow, Cooldown } from './framework/rate-limit.js';
import { createDispatcher } from './framework/dispatcher.js';
import { withRetry } from './framework/resolver.js';
import { createSparkleCommand } from './commands/sparkle.js';
import { createSparklesCommand } from './commands/sparkles.js';
import { createHelpCommand } from './commands/help.js';
import { createHealthServer } from './health.js';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

// Crash-safety: a transient error must neither kill the process nor wedge silently.
process.on('unhandledRejection', (reason) => log('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => {
  // Unsafe to continue from an unknown sync throw — log loudly and let K8s restart us.
  console.error('[uncaughtException]', err);
  process.exit(1);
});

const config = loadConfig();
if (!config.slackBotToken || !config.slackAppToken) {
  console.error('SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required.');
  process.exit(1);
}

const store = createSqliteStore(config.dbPath);
process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down...');
  store.close();
  process.exit(0);
});

const app = new App({
  token: config.slackBotToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
  appToken: config.slackAppToken,
});

app.error(async (err) => {
  log('[bolt app.error]', err);
});

async function main(): Promise<void> {
  // Cache bot identity once at startup; if this fails, exit — running with broken
  // bot-detection would disable the giver gate's own-bot carve-out.
  let botUserId: string;
  try {
    const auth = await withRetry(() => app.client.auth.test({ token: config.slackBotToken }));
    botUserId = (auth as { user_id: string }).user_id;
  } catch (err) {
    console.error('auth.test failed at startup; exiting for restart.', err);
    process.exit(1);
  }

  const resolver = new SlackResolver(app.client as never);
  const rateLimiter = new SlidingWindow(config.rateLimit.limit, config.rateLimit.windowMs);
  const messages = createMessages(config.personality);

  const registry = new Registry();
  registry.register(
    createSparkleCommand({
      messages,
      config: {
        currency: config.currency,
        currencyPlural: config.currencyPlural,
        partyMinutes: config.partyMinutes,
        partyMaxRecipients: config.partyMaxRecipients,
      },
      partyChannelCooldown: new Cooldown(config.partyChannelCooldownMs),
      partyGiverCooldown: new Cooldown(config.partyGiverCooldownMs),
    }),
  );
  registry.register(createSparklesCommand({ currency: config.currency, currencyPlural: config.currencyPlural }));
  registry.register(createHelpCommand(registry));

  const dispatch = createDispatcher({
    registry,
    resolver,
    store,
    rateLimiter,
    botUserId,
    client: app.client as never,
    log,
  });

  app.message(async ({ message }) => {
    await dispatch({ message: message as never });
  });

  // WS connection state for the health probe (SocketModeClient events).
  let wsConnected = false;
  const smClient = (app as unknown as { receiver?: { client?: NodeJS.EventEmitter } }).receiver?.client;
  smClient?.on('connected', () => { wsConnected = true; log('socket mode connected'); });
  smClient?.on('disconnected', () => { wsConnected = false; log('socket mode disconnected'); });

  createHealthServer({ ws: () => wsConnected, db: () => store.healthCheck() }, config.healthPort);

  await app.start();
  log(`sparklebot connected via Socket Mode (health on :${config.healthPort})`);
}

void main();
