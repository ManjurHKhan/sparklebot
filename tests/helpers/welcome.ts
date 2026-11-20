import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWelcomeHandler } from '../../src/framework/welcome.js';
import { SlackResolver } from '../../src/framework/resolver.js';
import { createSqliteStore } from '../../src/store/sqlite.js';
import { createMessages } from '../../src/messages.js';
import { emojiBurst } from '../../src/framework/safe.js';
import type { WelcomeChannel } from '../../src/config.js';
import { makeFakeSlack, type FakeUser } from './fake-slack.js';

export const BOT = 'U0FAKEBOT9';
export const NEW = 'U0FAKE0010';
export const WELCOME = 'C0FAKE0001';

export function welcomeHarness(opts: {
  users?: FakeUser[];
  tour?: WelcomeChannel[];
  suggestEnabled?: boolean;
} = {}) {
  const fake = makeFakeSlack({
    users: opts.users ?? [{ id: NEW, name: 'dana' }],
    channels: { [WELCOME]: 'general', C0FAKE0002: 'design', C0FAKE0003: 'old-stuff', C0FAKE0004: 'secret' },
    archivedChannels: ['C0FAKE0003'],
    privateChannels: ['C0FAKE0004'],
    botUserId: BOT,
  });
  const dbPath = join(mkdtempSync(join(tmpdir(), 'sparkle-welcome-')), 'x.db');
  const store = createSqliteStore(dbPath);
  const reader = new Database(dbPath, { readonly: true });
  const logs: string[] = [];
  const handler = createWelcomeHandler({
    client: fake.client as never,
    resolver: new SlackResolver(fake.client as never),
    store,
    messages: createMessages('playful'),
    botUserId: BOT,
    megaBurst: emojiBurst(':boom:'),
    suggestEnabled: opts.suggestEnabled ?? true,
    config: {
      welcomeChannel: WELCOME,
      welcomeChannels: opts.tour ?? [{ id: 'C0FAKE0002', about: 'where the designers hang out' }],
      currency: 'sparkle',
      currencyPlural: 'sparkles',
    },
    log: (...args) => logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')),
  });
  const rows = () => reader.prepare('SELECT giver_id, receiver_id, reason FROM sparkles').all();
  const join_ = (id = NEW) => handler({ user: { id } });
  const dm = () => fake.posts.filter((p) => p.channel.startsWith('D-'));
  return { fake, store, logs, rows, join: join_, dm };
}
